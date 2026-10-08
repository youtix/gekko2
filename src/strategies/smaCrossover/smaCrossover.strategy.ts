import { TradingPair } from '@models/utility.types';
import { pickTradedPair, PositionTracker } from '@strategies/positionTracker';
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
 * The market price is the close of the candle, whatever source (`src`) the SMA averages. A crossover is detected by comparing the
 * previous relative position of the price vs the SMA to the current one. A price within the tolerance of the SMA (see
 * compareWithTolerance) is on it, neither above nor below, and keeps the previous position: the price crosses once it leaves the SMA
 * on the other side.
 */
export class SMACrossover implements Strategy<SMACrossoverStrategyParams> {
  static schema = smaCrossoverStrategySchema;

  // Whether the price was above the SMA before the candle in progress, and whether it is at that candle: null until it is first off a
  // ready SMA. Both are recorded on every candle, the warmup included: recorded after the warmup only, the side of the last warmup
  // candle was unknown and the first candle after it only recorded where the price was, so a crossover between the two was missed.
  private wasPriceAboveSMA: boolean | null = null;
  private isPriceAboveSMA: boolean | null = null;
  private pair?: TradingPair;
  // Every order is all-in: the strategy buys only when flat and sells only when long, never while its order is pending. A crossover
  // the position does not allow is skipped: advised anyway, a first SELL had nothing to sell and was refused. An order canceled or
  // errored is not placed again: the next one waits for the next crossover.
  private readonly position = new PositionTracker();

  init({ candle, tools, addIndicator }: InitParams<SMACrossoverStrategyParams>): void {
    const { period, src } = tools.strategyParams;
    this.pair = pickTradedPair(candle, tools);
    addIndicator('SMA', this.pair, { period, src });
  }

  // Runs before onTimeframeCandleAfterWarmup on each candle, the warmup included: the side it moves aside is the previous candle's
  onEachTimeframeCandle(
    { candle, tools }: OnCandleEventParams<SMACrossoverStrategyParams>,
    ...indicators: IndicatorResults<number | null>[]
  ): void {
    const [sma] = indicators;
    this.wasPriceAboveSMA = this.isPriceAboveSMA;
    const price = this.pair ? candle.get(this.pair)?.close : undefined;
    if (!isFiniteNumber(price) || !isFiniteNumber(sma.results)) return;

    // On a flat window the SMA is the price in exact arithmetic, but its running sum leaves it a few ulps off, on either side: compared
    // strictly, that noise crossed the price on about half the flat windows, a round trip of fees on a market that had not moved, and
    // an exact tie counted as below, a SELL. Within the tolerance the price is on the SMA: no crossover, the side it was on is kept,
    // and the first side it takes is the initial state.
    const priceToSMA = compareWithTolerance(price, sma.results);
    if (priceToSMA === 0) return;
    this.isPriceAboveSMA = priceToSMA > 0;
    if (this.wasPriceAboveSMA === null) tools.log('info', `Initial state: price ${this.isPriceAboveSMA ? 'above' : 'below'} SMA`);
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

    // Detect crossovers: the price on the other side of the SMA than before this candle. None while the side before is unknown (the
    // first candle off a ready SMA only records it), nor while the price stays on its side or on the SMA.
    if (this.wasPriceAboveSMA === null || this.wasPriceAboveSMA === this.isPriceAboveSMA) return;
    if (this.wasPriceAboveSMA && this.position.canSell()) {
      // Price crossed below SMA => SMA crossed UP the price => SELL
      log('info', `SMA crossed UP price (${sma.results.toFixed(5)} > ${price.toFixed(5)}) => SELL`);
      this.position.sell(createOrder, { type: 'MARKET', symbol: this.pair });
    } else if (!this.wasPriceAboveSMA && this.position.canBuy()) {
      // Price crossed above SMA => SMA crossed DOWN the price => BUY
      log('info', `SMA crossed DOWN price (${sma.results.toFixed(5)} < ${price.toFixed(5)}) => BUY`);
      this.position.buy(createOrder, { type: 'MARKET', symbol: this.pair });
    }
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
