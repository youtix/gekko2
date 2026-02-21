import {
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { isNil } from 'lodash-es';
import { UUID } from 'node:crypto';
import { DebugAdviceParams } from './debugAdvice.types';
/** This strategy is used for debugging purposes. It is used in e2e tests to verify the pipeline too, so be careful when modifying it. */
export class DebugAdvice extends Strategy<DebugAdviceParams> {
  private index = 0;
  private activeOrders: Map<string, { orderId: UUID; cancelAt: number }> = new Map();

  onTimeframeCandleAfterWarmup({ candle, tools }: OnCandleEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { strategyParams, log, createOrder, cancelOrder } = tools;

    // Check for cancellations
    for (const [key, { orderId, cancelAt }] of this.activeOrders.entries()) {
      if (this.index >= cancelAt) {
        log('debug', `Cancelling order ${orderId} at index ${this.index}`);
        cancelOrder(orderId);
        this.activeOrders.delete(key);
      }
    }

    for (const pair of candle.keys()) {
      if (strategyParams.wait > this.index) continue;

      log('debug', `Iteration: ${this.index} for ${pair}`);

      if (this.index % strategyParams.each === 0) {
        log('debug', `Trigger SHORT for ${pair}`);
        const id = createOrder({ type: 'STICKY', side: 'SELL', amount: 1, symbol: pair });
        if (!isNil(strategyParams.cancelAfter)) {
          this.activeOrders.set(id, { orderId: id, cancelAt: this.index + strategyParams.cancelAfter });
        }
      } else if (this.index % strategyParams.each === strategyParams.each / 2) {
        log('debug', `Trigger LONG for ${pair}`);
        const id = createOrder({ type: 'STICKY', side: 'BUY', amount: 1, symbol: pair });
        if (!isNil(strategyParams.cancelAfter)) {
          this.activeOrders.set(id, { orderId: id, cancelAt: this.index + strategyParams.cancelAfter });
        }
      }
    }

    this.index++;
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { order, tools } = params;
    tools.log('debug', `Order Completed: ${order.id}`);
    this.activeOrders.delete(order.id);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { order, tools } = params;
    tools.log('debug', `Order Canceled: ${order.id}`);
    this.activeOrders.delete(order.id);
  }

  onOrderErrored(params: OnOrderErroredEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { order, tools } = params;
    tools.log('debug', `Order Errored: ${order.id}`);
    this.activeOrders.delete(order.id);
  }
}
