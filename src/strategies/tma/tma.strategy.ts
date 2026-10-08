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
import { tmaStrategySchema } from './tma.schema';
import { TMAStrategyParams } from './tma.types';

export class TMA implements Strategy<TMAStrategyParams> {
  static schema = tmaStrategySchema;

  private pair?: TradingPair;
  // An alignment holds for many candles in a row, and every order is all-in: the strategy buys once when flat and sells once when
  // long, never while its order is pending. Advised on every candle, each order after the first was sized from what the previous one
  // left, then refused once nothing was left, until maxConsecutiveErrors stopped the bot. An order canceled or errored is placed
  // again by the next candle of its signal, unless what it executed before it ended changed the position (see PositionTracker).
  private readonly position = new PositionTracker();

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
    if (!this.pair || !isFiniteNumber(short.results) || !isFiniteNumber(medium.results) || !isFiniteNumber(long.results)) return;

    const smas = `${short.results}/${medium.results}/${long.results}`;
    // On a flat stretch the SMAs that hold only its price are equal in exact arithmetic, but their running sums leave them a few ulps
    // apart, on either side: compared strictly, that noise made trends, several round trips of fees on a market that had not moved.
    // Within the tolerance two SMAs are equal, neither above nor below each other: a medium SMA equal to either other one is no trend.
    const shortToMedium = compareWithTolerance(short.results, medium.results);
    const mediumToLong = compareWithTolerance(medium.results, long.results);
    const isUptrend = shortToMedium > 0 && mediumToLong > 0;
    // A mixed alignment: the medium SMA above both others, or below both. A fully bearish one (short < medium < long) gives no signal.
    const isDowntrend = (shortToMedium < 0 && mediumToLong > 0) || (shortToMedium > 0 && mediumToLong < 0);

    if (isUptrend && this.position.canBuy()) {
      log('info', `Executing long advice due to detected uptrend: ${smas}`);
      this.position.buy(createOrder, { type: 'STICKY', symbol: this.pair });
    } else if (isDowntrend && this.position.canSell()) {
      log('info', `Executing short advice due to detected downtrend: ${smas}`);
      this.position.sell(createOrder, { type: 'STICKY', symbol: this.pair });
    } else if (!isUptrend && !isDowntrend) {
      log('debug', `No clear trend detected: ${smas}`);
    }
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<TMAStrategyParams>): void {
    this.position.onOrderCompleted(params);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<TMAStrategyParams>): void {
    this.position.onOrderCanceled(params);
  }

  onOrderErrored(params: OnOrderErroredEventParams<TMAStrategyParams>): void {
    this.position.onOrderErrored(params);
  }
}
