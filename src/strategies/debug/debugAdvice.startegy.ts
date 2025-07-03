import { TradeCompleted } from '@models/types/tradeStatus.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { DebugAdviceParams } from './debugAdvice.types';

export class DebugAdvice implements Strategy<DebugAdviceParams> {
  private index = 0;

  onCandleAfterWarmup({ strategyParams, debug, advice }: Tools<DebugAdviceParams>, ..._indicators: unknown[]): void {
    if (strategyParams.wait > this.index) return;

    debug('strategy', `Iteration: ${this.index}`);

    if (this.index % strategyParams.each === 0) {
      debug('strategy', 'Trigger SHORT');
      advice('short');
    } else if (this.index % strategyParams.each === strategyParams.each / 2) {
      debug('strategy', 'Trigger LONG');
      advice('long');
    }

    // if(i % 2 === 0)
    //   this.advice('long');
    // else if(i % 2 === 1)
    //   this.advice('short');

    this.index++;
  }

  init(_addIndicator: AddIndicatorFn, _strategyParams: unknown): void {}
  onEachCandle(_tools: Tools<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  onTradeCompleted(_trade: TradeCompleted): void {}
  log(_tools: Tools<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
