import type {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import type { EMARibbonStrategyParams } from './emaRibbon.types';

export class EMARibbon implements Strategy<EMARibbonStrategyParams> {
  private isLong?: boolean;

  init({ tools, addIndicator }: InitParams<EMARibbonStrategyParams>): void {
    const { src, count, start, step } = tools.strategyParams;
    addIndicator('EMARibbon', { src, count, start, step });
  }

  onTimeframeCandleAfterWarmup(
    { tools }: OnCandleEventParams<EMARibbonStrategyParams>,
    ...indicators: unknown[]
  ): void {
    const { createOrder } = tools;
    const [emaRibbon] = indicators as [{ results: number[]; spread: number }];
    if (emaRibbon === undefined || emaRibbon === null) return;

    // A bullish signal occurs when the EMA ribbon is ordered in DESC order (each faster EMA is above the slower one).
    const isBullish = emaRibbon.results.every((result, index, values) => !index || values[index - 1] > result);

    if (!this.isLong && isBullish) {
      createOrder({ type: 'STICKY', side: 'BUY' });
      this.isLong = true;
    }

    if (this.isLong && !isBullish) {
      createOrder({ type: 'STICKY', side: 'SELL' });
      this.isLong = false;
    }
  }

  log({ tools }: OnCandleEventParams<EMARibbonStrategyParams>, ...indicators: unknown[]): void {
    const { log } = tools;
    const [emaRibbon] = indicators as [{ results: number[]; spread: number }];
    if (emaRibbon === undefined || emaRibbon === null) return;
    log('debug', `Ribbon results: [${emaRibbon.results.join(' / ')}]`);
    log('debug', `Ribbon Spread: ${emaRibbon.spread}`);
  }

  // NOT USED
  onEachTimeframeCandle(_params: OnCandleEventParams<EMARibbonStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_params: OnOrderCompletedEventParams<EMARibbonStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCanceled(_params: OnOrderCanceledEventParams<EMARibbonStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderErrored(_params: OnOrderErroredEventParams<EMARibbonStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
