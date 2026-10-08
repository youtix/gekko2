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
import { isNumber } from 'lodash-es';
import { UUID } from 'node:crypto';
import { cciStrategySchema } from './cci.schema';
import { CCIStrategyParams, CCITrend } from './cci.types';

export class CCI implements Strategy<CCIStrategyParams> {
  static schema = cciStrategySchema;

  private trend: CCITrend;
  private pair?: TradingPair;
  // A trend starts again each time the CCI comes back from between the thresholds, and every order is all-in: the strategy buys only
  // when flat and sells only when long, never while its order is pending. Advised on every new overbought (oversold) trend, each SELL
  // (BUY) after the first was sized from what the previous one left, then refused once nothing was left, until maxConsecutiveErrors
  // stopped the bot.
  private isLong = false;
  private buyOrderId?: UUID;
  private sellOrderId?: UUID;
  private isPendingOrder = false;

  constructor() {
    this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
  }

  init({ candle, tools, addIndicator }: InitParams<CCIStrategyParams>): void {
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('CCI', this.pair, { period: tools.strategyParams.period });
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<CCIStrategyParams>, ...indicators: IndicatorResults[]): void {
    const { strategyParams, createOrder, log } = tools;
    const [cci] = indicators;
    if (!isNumber(cci.results) || !this.pair) return;

    const { up, down, persistence } = strategyParams.thresholds;

    if (cci.results >= up) {
      if (this.trend.direction !== 'overbought') {
        log('info', 'CCI: overbought trend detected');
        this.trend = { direction: 'overbought', duration: 1, persisted: persistence === 0, adviced: false };
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
      }
      // Left unadviced while flat or while an order is pending: a BUY that fills during the trend is sold on its next candle
      if (this.trend.persisted && !this.trend.adviced && this.isLong && !this.isPendingOrder) {
        this.trend.adviced = true;
        this.sellOrderId = createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
        this.isPendingOrder = true;
      }
    } else if (cci.results <= down) {
      if (this.trend.direction !== 'oversold') {
        log('info', 'CCI: oversold trend detected');
        this.trend = { direction: 'oversold', duration: 1, persisted: persistence === 0, adviced: false };
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
      }
      if (this.trend.persisted && !this.trend.adviced && !this.isLong && !this.isPendingOrder) {
        this.trend.adviced = true;
        this.buyOrderId = createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
        this.isPendingOrder = true;
      }
    } else {
      if (this.trend.direction !== 'nodirection') {
        this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
      } else {
        this.trend.duration++;
      }
    }

    log('debug', `Trend: ${this.trend.direction} for ${this.trend.duration}`);
  }

  log({ tools }: OnCandleEventParams<CCIStrategyParams>, ...indicators: IndicatorResults[]): void {
    const [cci] = indicators;
    if (!isNumber(cci.results)) return;
    tools.log('debug', `CCI: ${cci.results.toFixed(2)}`);
  }

  onOrderCompleted({ order }: OnOrderCompletedEventParams<CCIStrategyParams>): void {
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

  onOrderCanceled({ order }: OnOrderCanceledEventParams<CCIStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  onOrderErrored({ order }: OnOrderErroredEventParams<CCIStrategyParams>): void {
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
