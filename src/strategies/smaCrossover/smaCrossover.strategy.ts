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
import { smaCrossoverStrategySchema } from './smaCrossover.schema';
import { SMACrossoverStrategyParams } from './smaCrossover.types';

/**
 * Simple Moving Average Crossover Strategy
 *
 * - When MA crosses UP the market price => SELL (market order, all in), when long
 * - When MA crosses DOWN the market price => BUY (market order, all in), when flat
 *
 * A crossover is detected by comparing the previous relative position
 * of the price vs the SMA to the current one.
 */
export class SMACrossover implements Strategy<SMACrossoverStrategyParams> {
  static schema = smaCrossoverStrategySchema;

  /** Tracks whether price was above SMA in the previous candle */
  private wasPriceAboveSMA: boolean | null = null;
  private pair?: TradingPair;
  // Every order is all-in: the strategy buys only when flat and sells only when long, never while its order is pending. A crossover
  // the position does not allow is skipped: advised anyway, a first SELL had nothing to sell and was refused.
  private isLong = false;
  private buyOrderId?: UUID;
  private sellOrderId?: UUID;
  private isPendingOrder = false;

  init({ candle, tools, addIndicator }: InitParams<SMACrossoverStrategyParams>): void {
    const { period, src } = tools.strategyParams;
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('SMA', this.pair, { period, src });
  }

  onTimeframeCandleAfterWarmup(
    { candle, tools }: OnCandleEventParams<SMACrossoverStrategyParams>,
    ...indicators: IndicatorResults<number | null>[]
  ): void {
    const { log, createOrder } = tools;
    const [sma] = indicators;

    if (!this.pair) return;
    const currentCandle = candle.get(this.pair);
    if (!currentCandle) return;
    const price = currentCandle.close;

    if (!isNumber(sma.results)) return;

    const isPriceAboveSMA = price > sma.results;

    // First candle after warmup - just record the position
    if (this.wasPriceAboveSMA === null) {
      this.wasPriceAboveSMA = isPriceAboveSMA;
      log('info', `Initial state: price ${isPriceAboveSMA ? 'above' : 'below'} SMA`);
      return;
    }

    // Detect crossovers
    if (this.wasPriceAboveSMA && !isPriceAboveSMA && this.isLong && !this.isPendingOrder) {
      // Price crossed below SMA => SMA crossed UP the price => SELL
      log('info', `SMA crossed UP price (${sma.results.toFixed(5)} > ${price.toFixed(5)}) => SELL`);
      this.sellOrderId = createOrder({ type: 'MARKET', side: 'SELL', symbol: this.pair });
      this.isPendingOrder = true;
    } else if (!this.wasPriceAboveSMA && isPriceAboveSMA && !this.isLong && !this.isPendingOrder) {
      // Price crossed above SMA => SMA crossed DOWN the price => BUY
      log('info', `SMA crossed DOWN price (${sma.results.toFixed(5)} < ${price.toFixed(5)}) => BUY`);
      this.buyOrderId = createOrder({ type: 'MARKET', side: 'BUY', symbol: this.pair });
      this.isPendingOrder = true;
    }

    this.wasPriceAboveSMA = isPriceAboveSMA;
  }

  log({ candle, tools }: OnCandleEventParams<SMACrossoverStrategyParams>, ...indicators: IndicatorResults<number | null>[]): void {
    const { log } = tools;
    const [sma] = indicators;

    if (!this.pair) return;
    const currentCandle = candle.get(this.pair);
    if (!currentCandle) return;

    if (!isNumber(sma.results)) return;

    log('debug', `SMA: ${sma.results.toFixed(5)} | Price: ${currentCandle.close.toFixed(5)}`);
  }

  onOrderCompleted({ order }: OnOrderCompletedEventParams<SMACrossoverStrategyParams>): void {
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

  onOrderCanceled({ order }: OnOrderCanceledEventParams<SMACrossoverStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  onOrderErrored({ order }: OnOrderErroredEventParams<SMACrossoverStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  /**
   * An order canceled or errored leaves the position as it was before it: the next order waits for the next crossover. What a
   * canceled order filled is still held: the next all-in order completes it.
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
