import type { TradeCompleted } from '@models/tradeStatus.types';
import type { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import type { EMARibbonStrategyParams } from './emaRibbon.types';

export class EMARibbon implements Strategy<EMARibbonStrategyParams> {
  private isLong?: boolean;

  init(addIndicator: AddIndicatorFn, strategyParams: EMARibbonStrategyParams): void {
    const { src, count, start, step } = strategyParams;
    addIndicator('EMARibbon', { src, count, start, step });
  }

  onCandleAfterWarmup({ advice }: Tools<EMARibbonStrategyParams>, ...indicators: unknown[]): void {
    const [emaRibbon] = indicators as [{ results: number[]; spread: number }];
    if (emaRibbon === undefined || emaRibbon === null) return;

    // A bullish signal occurs when the EMA ribbon is ordered in DESC order (each faster EMA is above the slower one).
    const isBullish = emaRibbon.results.every((result, index, values) => !index || values[index - 1] > result);

    if (!this.isLong && isBullish) {
      advice('long');
      this.isLong = true;
    }

    if (this.isLong && !isBullish) {
      advice('short');
      this.isLong = false;
    }
  }

  log({ log }: Tools<EMARibbonStrategyParams>, ...indicators: unknown[]): void {
    const [emaRibbon] = indicators as [{ results: number[]; spread: number }];
    if (emaRibbon === undefined || emaRibbon === null) return;
    log('debug', `Ribbon results: [${emaRibbon.results.join(' / ')}]`);
    log('debug', `Ribbon Spread: ${emaRibbon.spread}`);
  }

  // NOT USED
  onEachCandle(_tools: Tools<EMARibbonStrategyParams>, ..._indicators: unknown[]): void {}
  onTradeCompleted(_trade: TradeCompleted): void {}
  end(): void {}
}
