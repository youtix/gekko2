import { TradingPair } from '@models/utility.types';
import {
  IndicatorResults,
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { pluralize } from '@utils/string/string.utils';
import { isNumber, isObject } from 'lodash-es';
import { UUID } from 'node:crypto';
import { MACDStrategyParams, MACDTrend } from './macd.types';

export class MACD implements Strategy<MACDStrategyParams> {
  private trend?: MACDTrend;
  private pair?: TradingPair;
  // A trend starts again when the MACD crosses back, even for fewer candles than the persistence, and every order is all-in: the
  // strategy buys only when flat and sells only when long, never while its order is pending. A blip shorter than the persistence
  // advised the same side again, a BUY sized from what the previous one left, or a SELL with nothing left to sell.
  private isLong = false;
  private buyOrderId?: UUID;
  private sellOrderId?: UUID;
  private isPendingOrder = false;

  init({ candle, tools, addIndicator }: InitParams<MACDStrategyParams>): void {
    const { strategyParams } = tools;
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('MACD', this.pair, { short: strategyParams.short, long: strategyParams.long, signal: strategyParams.signal });
    this.trend = { direction: 'none', duration: 0, persisted: false, adviced: false };
  }

  onTimeframeCandleAfterWarmup(
    { tools }: OnCandleEventParams<MACDStrategyParams>,
    ...indicators: IndicatorResults<{ macd: number; signal: number; hist: number } | null>[]
  ): void {
    const { strategyParams, log, createOrder } = tools;
    const { macdSrc } = strategyParams;
    const [macd] = indicators;

    if (!this.isMacd(macd.results) || !this.pair) return;

    if (macd.results[macdSrc] > strategyParams.thresholds.up) {
      if (this.trend?.direction !== 'up') {
        log('info', 'MACD: up trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'up', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In uptrend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= strategyParams.thresholds.persistence) this.trend.persisted = true;

      // Left unadviced while long or while an order is pending: a SELL that fills during the trend is bought back on its next candle
      if (this.trend.persisted && !this.trend.adviced && !this.isLong && !this.isPendingOrder) {
        this.trend.adviced = true;
        this.buyOrderId = createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
        this.isPendingOrder = true;
      }
    } else if (macd.results[macdSrc] < strategyParams.thresholds.down) {
      if (this.trend?.direction !== 'down') {
        log('info', 'MACD: down trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'down', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In downtrend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= strategyParams.thresholds.persistence) this.trend.persisted = true;

      if (this.trend.persisted && !this.trend.adviced && this.isLong && !this.isPendingOrder) {
        this.trend.adviced = true;
        this.sellOrderId = createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
        this.isPendingOrder = true;
      }
    } else {
      log('debug', 'MACD: no trend detected');
    }
  }

  log(
    { tools }: OnCandleEventParams<MACDStrategyParams>,
    ...indicators: IndicatorResults<{ macd: number; signal: number; hist: number } | null>[]
  ): void {
    const { log } = tools;
    const [macd] = indicators;
    if (!this.isMacd(macd.results)) return;

    log('debug', `macd: ${macd.results.macd.toFixed(8)}`);
    log('debug', `signal: ${macd.results.signal.toFixed(8)}`);
    log('debug', `hist: ${macd.results.hist.toFixed(8)}`);
  }

  onOrderCompleted({ order }: OnOrderCompletedEventParams<MACDStrategyParams>): void {
    if (order.id === this.buyOrderId) {
      this.isLong = true;
      this.buyOrderId = undefined;
      this.isPendingOrder = false;
    } else if (order.id === this.sellOrderId) {
      this.isLong = false;
      this.sellOrderId = undefined;
      this.isPendingOrder = false;
    }
  }

  onOrderCanceled({ order }: OnOrderCanceledEventParams<MACDStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  onOrderErrored({ order }: OnOrderErroredEventParams<MACDStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  /**
   * An order canceled or errored leaves the position as it was before it. The trend it was placed in is adviced: the next order waits
   * for the next trend. What a canceled order filled is still held: the next all-in order completes it.
   */
  private handleOrderFailure(orderId: UUID) {
    if (orderId === this.buyOrderId) {
      this.isLong = false;
      this.buyOrderId = undefined;
      this.isPendingOrder = false;
    } else if (orderId === this.sellOrderId) {
      this.isLong = true;
      this.sellOrderId = undefined;
      this.isPendingOrder = false;
    }
  }

  private isMacd(data: unknown): data is { macd: number; signal: number; hist: number } {
    return (
      isObject(data) &&
      'macd' in data &&
      'signal' in data &&
      'hist' in data &&
      isNumber(data.macd) &&
      isNumber(data.signal) &&
      isNumber(data.hist)
    );
  }
}
