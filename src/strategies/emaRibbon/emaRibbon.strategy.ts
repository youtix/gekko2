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
import { isSorted } from '@utils/collection/array.utils';
import { emaRibbonStrategySchema } from './emaRibbon.schema';
import type { EMARibbonStrategyParams } from './emaRibbon.types';

export class EMARibbon implements Strategy<EMARibbonStrategyParams> {
  static schema = emaRibbonStrategySchema;

  private pair?: TradingPair;
  // Every order is all-in: the strategy buys only when flat and sells only when long, never while its order is pending. An order
  // canceled or errored is placed again by the next candle that signals it, unless what it executed before it ended changed the
  // position (see PositionTracker).
  private readonly position = new PositionTracker();
  private lastSpreadValue?: number;

  init({ candle, tools, addIndicator }: InitParams<EMARibbonStrategyParams>): void {
    const [pair] = candle.keys();
    this.pair = pair;
    const { src, count, start, step } = tools.strategyParams;
    addIndicator('EMARibbon', this.pair, { src, count, start, step });
  }

  onTimeframeCandleAfterWarmup(
    { tools }: OnCandleEventParams<EMARibbonStrategyParams>,
    ...indicators: IndicatorResults<{ results: number[]; spread: number } | null>[]
  ): void {
    const [emaRibbon] = indicators;
    const { createOrder, strategyParams } = tools;
    const { spreadCompressionThreshold } = strategyParams;
    if (!this.pair || emaRibbon.results === undefined || emaRibbon.results === null) return;

    // A bullish signal occurs when the EMA ribbon is in strictly descending order (each faster EMA is above the slower one).
    const isBullish = isSorted(emaRibbon.results.results, 'SDesc');
    const isSpreadCompressed = emaRibbon.results.spread < spreadCompressionThreshold;
    const isSpreadCompressing = this.lastSpreadValue !== undefined && emaRibbon.results.spread < this.lastSpreadValue;

    if (isBullish && isSpreadCompressed && !isSpreadCompressing && this.position.canBuy()) {
      this.position.buy(createOrder, { type: 'STICKY', symbol: this.pair });
    }

    if (isSpreadCompressing && this.position.canSell()) {
      this.position.sell(createOrder, { type: 'STICKY', symbol: this.pair });
    }

    this.lastSpreadValue = emaRibbon.results.spread;
  }

  log(
    { tools }: OnCandleEventParams<EMARibbonStrategyParams>,
    ...indicators: IndicatorResults<{ results: number[]; spread: number } | null>[]
  ): void {
    const { log } = tools;
    const [emaRibbon] = indicators;
    if (emaRibbon.results === undefined || emaRibbon.results === null) return;
    log('debug', `Ribbon results: [${emaRibbon.results.results.join(' / ')}]`);
    log('debug', `Ribbon Spread: ${emaRibbon.results.spread}`);
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<EMARibbonStrategyParams>): void {
    this.position.onOrderCompleted(params);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<EMARibbonStrategyParams>): void {
    this.position.onOrderCanceled(params);
  }

  onOrderErrored(params: OnOrderErroredEventParams<EMARibbonStrategyParams>): void {
    this.position.onOrderErrored(params);
  }
}
