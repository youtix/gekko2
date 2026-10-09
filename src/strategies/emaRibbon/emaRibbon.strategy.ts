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
import { compareWithTolerance } from '@utils/math/math.utils';
import { emaRibbonStrategySchema } from './emaRibbon.schema';
import type { EMARibbonStrategyParams } from './emaRibbon.types';

type RibbonResults = IndicatorResults<IndicatorRegistry['EMARibbon']['output']>;

export class EMARibbon implements Strategy<EMARibbonStrategyParams> {
  static schema = emaRibbonStrategySchema;

  private pair?: TradingPair;
  // Every order is all-in: the strategy buys only when flat and sells only when long, never while its order is pending. An order
  // canceled or errored is placed again by the next candle that signals it, unless what it executed before it ended changed the
  // position (see PositionTracker).
  private readonly position = new PositionTracker();
  // The spreads of the candle in progress and of the one before, recorded on every candle, the warmup included. Recorded after the
  // warmup only, the first candle after it had no spread to compare with: it bought a ribbon that was narrowing, sold at the next.
  private spread?: number;
  private previousSpread?: number;

  init({ candle, tools, addIndicator }: InitParams<EMARibbonStrategyParams>): void {
    this.pair = pickTradedPair(candle, tools);
    const { src, count, start, step } = tools.strategyParams;
    addIndicator('EMARibbon', this.pair, { src, count, start, step });
  }

  // Runs before onTimeframeCandleAfterWarmup on each candle: the spread it moves aside is the previous candle's
  onEachTimeframeCandle(_params: OnCandleEventParams<EMARibbonStrategyParams>, ...indicators: RibbonResults[]): void {
    const [emaRibbon] = indicators;
    this.previousSpread = this.spread;
    this.spread = emaRibbon.results?.spread;
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<EMARibbonStrategyParams>, ...indicators: RibbonResults[]): void {
    const [emaRibbon] = indicators;
    const { createOrder, strategyParams } = tools;
    const { spreadCompressionThreshold } = strategyParams;
    if (!this.pair || emaRibbon.results === undefined || emaRibbon.results === null) return;
    const { results, spread } = emaRibbon.results;

    // Bullish: each EMA above the next, slower one. On a long flat stretch each EMA freezes a few ulps short of the price once its step
    // rounds away, the faster ones nearer: reached from below, the ribbon stayed in descending order by those residues alone, its spread
    // stopped narrowing, and it bought after some 600 flat candles. EMAs within the tolerance of each other are equal: not bullish.
    const isBullish = results.every((ema, index) => index === 0 || compareWithTolerance(results[index - 1], ema) > 0);
    const isSpreadCompressed = spread < spreadCompressionThreshold;
    // A ribbon moving in parallel, on a steady trend, keeps its spread in exact arithmetic, but the computed spread wobbles by ulps:
    // compared strictly, a wobble down narrowed it, a SELL then a BUY again. Within the tolerance the spread is unchanged, which is not
    // narrowing, nor is a spread with none before it (the ribbon's first candle).
    const isSpreadNarrowing = this.previousSpread !== undefined && compareWithTolerance(spread, this.previousSpread) < 0;

    if (isBullish && isSpreadCompressed && !isSpreadNarrowing && this.position.canBuy()) {
      this.position.buy(createOrder, { type: 'STICKY', symbol: this.pair });
    }

    if (isSpreadNarrowing && this.position.canSell()) {
      this.position.sell(createOrder, { type: 'STICKY', symbol: this.pair });
    }
  }

  log({ tools }: OnCandleEventParams<EMARibbonStrategyParams>, ...indicators: RibbonResults[]): void {
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
