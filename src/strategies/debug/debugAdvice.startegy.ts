import { debug } from '@services/logger';
import { Strategy } from '@strategies/strategy';

export class DebugAdvice extends Strategy<'DebugAdvice'> {
  private index = 0;
  protected init(): void {}
  protected onEachCandle(): void {}
  protected onCandleAfterWarmup(): void {
    if (this.strategySettings.wait > this.index) return;

    debug('strategy', `Iteration: ${this.index}`);

    if (this.index % this.strategySettings.each === 0) {
      debug('strategy', 'Trigger SHORT');
      this.advice('short');
    } else if (this.index % this.strategySettings.each === this.strategySettings.each / 2) {
      debug('strategy', 'Trigger LONG');
      this.advice('long');
    }

    // if(i % 2 === 0)
    //   this.advice('long');
    // else if(i % 2 === 1)
    //   this.advice('short');

    this.index++;
  }
  protected onTradeExecuted(): void {}
  protected log(): void {}
  protected end(): void {}
}
