import { TradingPair } from '@models/utility.types';
import { IndicatorResults, InitParams, OnCandleEventParams, Strategy } from '@strategies/strategy.types';
import type { EMARibbonStrategyParams } from './emaRibbon.types';

export class EMARibbon implements Strategy<EMARibbonStrategyParams> {
  private isLong?: boolean;
  private pair?: TradingPair;

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
    const { createOrder } = tools;
    const [emaRibbon] = indicators;
    if (!this.pair || emaRibbon.results === undefined || emaRibbon.results === null) return;

    // A bullish signal occurs when the EMA ribbon is ordered in DESC order (each faster EMA is above the slower one).
    const isBullish = emaRibbon.results.results.every((result, index, values) => !index || values[index - 1] > result);

    if (!this.isLong && isBullish) {
      createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
      this.isLong = true;
    }

    if (this.isLong && !isBullish) {
      createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
      this.isLong = false;
    }
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
}
