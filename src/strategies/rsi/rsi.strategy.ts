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
import { isNumber } from 'lodash-es';
import { UUID } from 'node:crypto';
import { RSICurrentTrend, RSIStrategyParams } from './rsi.types';

export class RSI implements Strategy<RSIStrategyParams> {
  private trend: RSICurrentTrend;
  private pair?: TradingPair;
  // A trend starts again when the RSI crosses the other threshold, even for fewer candles than the persistence, and every order is
  // all-in: the strategy buys only when flat and sells only when long, never while its order is pending. A blip shorter than the
  // persistence advised the same side again, a BUY sized from what the previous one left, or a SELL with nothing left to sell.
  private isLong = false;
  private buyOrderId?: UUID;
  private sellOrderId?: UUID;
  private isPendingOrder = false;

  constructor() {
    this.trend = { direction: 'none', duration: 0, adviced: false };
  }

  init({ candle, tools, addIndicator }: InitParams<RSIStrategyParams>): void {
    const { period, src } = tools.strategyParams;
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('RSI', this.pair, { period, src });
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<RSIStrategyParams>, ...indicators: IndicatorResults<number | null>[]): void {
    const { strategyParams, log, createOrder } = tools;
    const [rsi] = indicators;
    if (!isNumber(rsi.results) || !this.pair) return;
    const { thresholds } = strategyParams;

    if (rsi.results > thresholds.high) {
      if (this.trend.direction !== 'high') {
        log('info', 'RSI: high trend detected');
        this.trend = { duration: 0, direction: 'high', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In high trend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      // Left unadviced while flat or while an order is pending: a BUY that fills during the trend is sold on its next candle
      if (this.trend.duration >= thresholds.persistence && !this.trend.adviced && this.isLong && !this.isPendingOrder) {
        this.trend.adviced = true;
        this.sellOrderId = createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
        this.isPendingOrder = true;
      }
    } else if (rsi.results < thresholds.low) {
      if (this.trend.direction !== 'low') {
        log('info', 'RSI: low trend detected');
        this.trend = { duration: 0, direction: 'low', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In low trend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= thresholds.persistence && !this.trend.adviced && !this.isLong && !this.isPendingOrder) {
        this.trend.adviced = true;
        this.buyOrderId = createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
        this.isPendingOrder = true;
      }
    }
  }

  onOrderCompleted({ order }: OnOrderCompletedEventParams<RSIStrategyParams>): void {
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

  onOrderCanceled({ order }: OnOrderCanceledEventParams<RSIStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  onOrderErrored({ order }: OnOrderErroredEventParams<RSIStrategyParams>): void {
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
}
