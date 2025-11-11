import { OrderCanceled, OrderCompleted, OrderErrored } from '@models/order.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { DebugAdviceParams } from './debugAdvice.types';

export class DebugAdvice implements Strategy<DebugAdviceParams> {
  private index = 0;

  onCandleAfterWarmup({ strategyParams, log, createOrder }: Tools<DebugAdviceParams>, ..._indicators: unknown[]): void {
    if (strategyParams.wait > this.index) return;

    log('debug', `Iteration: ${this.index}`);

    if (this.index % strategyParams.each === 0) {
      log('debug', 'Trigger SHORT');
      createOrder({ type: 'STICKY', side: 'SELL', quantity: 1 });
    } else if (this.index % strategyParams.each === strategyParams.each / 2) {
      log('debug', 'Trigger LONG');
      createOrder({ type: 'STICKY', side: 'BUY', quantity: 1 });
    }

    // if(i % 2 === 0)
    //   this.advice('long');
    // else if(i % 2 === 1)
    //   this.advice('short');

    this.index++;
  }

  init(_addIndicator: AddIndicatorFn, _strategyParams: unknown): void {}
  onEachCandle(_tools: Tools<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_order: OrderCompleted): void {}
  onOrderCanceled(_order: OrderCanceled): void {}
  onOrderErrored(_order: OrderErrored): void {}
  log(_tools: Tools<DebugAdviceParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
