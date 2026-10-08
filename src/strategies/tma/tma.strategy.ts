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
import { tmaStrategySchema } from './tma.schema';
import { TMAStrategyParams } from './tma.types';

export class TMA implements Strategy<TMAStrategyParams> {
  static schema = tmaStrategySchema;

  private pair?: TradingPair;
  // An alignment holds for many candles in a row, and every order is all-in: the strategy buys once when flat and sells once when
  // long, never while its order is pending. Advised on every candle, each order after the first was sized from what the previous one
  // left, then refused once nothing was left, until maxConsecutiveErrors stopped the bot.
  private isLong = false;
  private buyOrderId?: UUID;
  private sellOrderId?: UUID;
  private isPendingOrder = false;

  init({ candle, tools, addIndicator }: InitParams<TMAStrategyParams>): void {
    const { long, medium, short, src } = tools.strategyParams;
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('SMA', this.pair, { period: short, src });
    addIndicator('SMA', this.pair, { period: medium, src });
    addIndicator('SMA', this.pair, { period: long, src });
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<TMAStrategyParams>, ...indicators: IndicatorResults<number | null>[]): void {
    const { log, createOrder } = tools;
    const [short, medium, long] = indicators;
    if (!this.pair || !isNumber(short.results) || !isNumber(medium.results) || !isNumber(long.results)) return;

    const smas = `${short.results}/${medium.results}/${long.results}`;
    const isUptrend = short.results > medium.results && medium.results > long.results;
    // A mixed alignment: the medium SMA above both others, or below both. A fully bearish one (short < medium < long) gives no signal.
    const isDowntrend =
      (short.results < medium.results && medium.results > long.results) ||
      (short.results > medium.results && medium.results < long.results);

    if (isUptrend && !this.isLong && !this.isPendingOrder) {
      log('info', `Executing long advice due to detected uptrend: ${smas}`);
      this.buyOrderId = createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
      this.isPendingOrder = true;
    } else if (isDowntrend && this.isLong && !this.isPendingOrder) {
      log('info', `Executing short advice due to detected downtrend: ${smas}`);
      this.sellOrderId = createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
      this.isPendingOrder = true;
    } else if (!isUptrend && !isDowntrend) {
      log('debug', `No clear trend detected: ${smas}`);
    }
  }

  onOrderCompleted({ order }: OnOrderCompletedEventParams<TMAStrategyParams>): void {
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

  onOrderCanceled({ order }: OnOrderCanceledEventParams<TMAStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  onOrderErrored({ order }: OnOrderErroredEventParams<TMAStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  /**
   * An order canceled or errored leaves the position as it was before it, and the next candle of the signal places it again. What a
   * canceled order filled is still held: the next all-in order completes it (a BUY spends the rest, a SELL sells everything).
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
