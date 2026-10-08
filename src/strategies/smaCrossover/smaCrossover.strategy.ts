import { TradingPair } from '@models/utility.types';
import { PositionTracker } from '@strategies/positionTracker';
import {
  IndicatorResults,
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { compareWithTolerance, isFiniteNumber } from '@utils/math/math.utils';
import { smaCrossoverStrategySchema } from './smaCrossover.schema';
import { SMACrossoverStrategyParams } from './smaCrossover.types';

/**
 * Simple Moving Average Crossover Strategy
 *
 * - When MA crosses UP the market price => SELL (market order, all in), when long
 * - When MA crosses DOWN the market price => BUY (market order, all in), when flat
 *
 * A crossover is detected by comparing the previous relative position
 * of the price vs the SMA to the current one. A price within the tolerance of the SMA (see compareWithTolerance) is on it, neither
 * above nor below, and keeps the previous position: the price crosses once it leaves the SMA on the other side.
 */
export class SMACrossover implements Strategy<SMACrossoverStrategyParams> {
  static schema = smaCrossoverStrategySchema;

  /** Tracks whether price was above SMA in the previous candle */
  private wasPriceAboveSMA: boolean | null = null;
  private pair?: TradingPair;
  // Every order is all-in: the strategy buys only when flat and sells only when long, never while its order is pending. A crossover
  // the position does not allow is skipped: advised anyway, a first SELL had nothing to sell and was refused. An order canceled or
  // errored is not placed again: the next one waits for the next crossover.
  private readonly position = new PositionTracker();

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

    if (!isFiniteNumber(sma.results)) return;

    // On a flat window the SMA is the price in exact arithmetic, but its running sum leaves it a few ulps off, on either side: compared
    // strictly, that noise crossed the price on about half the flat windows, a round trip of fees on a market that had not moved, and
    // an exact tie counted as below, a SELL. Within the tolerance the price is on the SMA: no crossover, the side it was on is kept,
    // and after the warmup the first side it takes is the initial state.
    const priceToSMA = compareWithTolerance(price, sma.results);
    if (priceToSMA === 0) return;
    const isPriceAboveSMA = priceToSMA > 0;

    // First candle after warmup - just record the position
    if (this.wasPriceAboveSMA === null) {
      this.wasPriceAboveSMA = isPriceAboveSMA;
      log('info', `Initial state: price ${isPriceAboveSMA ? 'above' : 'below'} SMA`);
      return;
    }

    // Detect crossovers
    if (this.wasPriceAboveSMA && !isPriceAboveSMA && this.position.canSell()) {
      // Price crossed below SMA => SMA crossed UP the price => SELL
      log('info', `SMA crossed UP price (${sma.results.toFixed(5)} > ${price.toFixed(5)}) => SELL`);
      this.position.sell(createOrder, { type: 'MARKET', symbol: this.pair });
    } else if (!this.wasPriceAboveSMA && isPriceAboveSMA && this.position.canBuy()) {
      // Price crossed above SMA => SMA crossed DOWN the price => BUY
      log('info', `SMA crossed DOWN price (${sma.results.toFixed(5)} < ${price.toFixed(5)}) => BUY`);
      this.position.buy(createOrder, { type: 'MARKET', symbol: this.pair });
    }

    this.wasPriceAboveSMA = isPriceAboveSMA;
  }

  log({ candle, tools }: OnCandleEventParams<SMACrossoverStrategyParams>, ...indicators: IndicatorResults<number | null>[]): void {
    const { log } = tools;
    const [sma] = indicators;

    if (!this.pair) return;
    const currentCandle = candle.get(this.pair);
    if (!currentCandle) return;

    if (!isFiniteNumber(sma.results)) return;

    log('debug', `SMA: ${sma.results.toFixed(5)} | Price: ${currentCandle.close.toFixed(5)}`);
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<SMACrossoverStrategyParams>): void {
    this.position.onOrderCompleted(params);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<SMACrossoverStrategyParams>): void {
    this.position.onOrderCanceled(params);
  }

  onOrderErrored(params: OnOrderErroredEventParams<SMACrossoverStrategyParams>): void {
    this.position.onOrderErrored(params);
  }
}
