import type { TradeCompleted } from '@models/types/tradeStatus.types';
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

  // NOT USED
  onEachCandle(_tools: Tools<EMARibbonStrategyParams>, ..._indicators: unknown[]): void {}
  onTradeCompleted(_trade: TradeCompleted): void {}
  log(_tools: Tools<EMARibbonStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
