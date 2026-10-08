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
import { isNumber } from 'lodash-es';
import { tmaStrategySchema } from './tma.schema';
import { TMAStrategyParams } from './tma.types';

export class TMA implements Strategy<TMAStrategyParams> {
  static schema = tmaStrategySchema;

  private pair?: TradingPair;
  // An alignment holds for many candles in a row, and every order is all-in: the strategy buys once when flat and sells once when
  // long, never while its order is pending. Advised on every candle, each order after the first was sized from what the previous one
  // left, then refused once nothing was left, until maxConsecutiveErrors stopped the bot. An order canceled or errored is placed
  // again by the next candle of its signal.
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
    if (!this.pair || !isNumber(short.results) || !isNumber(medium.results) || !isNumber(long.results)) return;

    const smas = `${short.results}/${medium.results}/${long.results}`;
    const isUptrend = short.results > medium.results && medium.results > long.results;
    // A mixed alignment: the medium SMA above both others, or below both. A fully bearish one (short < medium < long) gives no signal.
    const isDowntrend =
      (short.results < medium.results && medium.results > long.results) ||
      (short.results > medium.results && medium.results < long.results);

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
