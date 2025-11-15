import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { DebugAdviceParams } from './debugAdvice.types';

export class DebugAdvice implements Strategy<DebugAdviceParams> {
  private index = 0;

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { strategyParams, log, createOrder } = tools;
    if (strategyParams.wait > this.index) return;

    log('debug', `Iteration: ${this.index}`);

    if (this.index % strategyParams.each === 0) {
      log('debug', 'Trigger SHORT');
      createOrder({ type: 'STICKY', side: 'SELL', amount: 1 });
    } else if (this.index % strategyParams.each === strategyParams.each / 2) {
      log('debug', 'Trigger LONG');
      createOrder({ type: 'STICKY', side: 'BUY', amount: 1 });
    }

    // if(i % 2 === 0)
    //   this.advice('long');
    // else if(i % 2 === 1)
    //   this.advice('short');

    this.index++;
  }
  init(_params: InitParams<DebugAdviceParams>): void {}
  onEachTimeframeCandle(_params: OnCandleEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  log(_params: OnCandleEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_params: OnOrderCompletedEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  onOrderCanceled(_params: OnOrderCanceledEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  onOrderErrored(_params: OnOrderErroredEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
