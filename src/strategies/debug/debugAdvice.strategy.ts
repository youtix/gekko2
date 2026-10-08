import { OrderSide } from '@models/order.types';
import {
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { isNil } from 'lodash-es';
import { UUID } from 'node:crypto';
import { debugAdviceStrategySchema } from './debugAdvice.schema';
import { DebugAdviceParams } from './debugAdvice.types';

/**
 * The side of the advice `elapsed` candles after the first one, or undefined on a candle between two: every `each` candles, a SELL
 * first, then a BUY, and so on. The side used to follow the remainder of the candle index by `each`, with the BUY at `each / 2`,
 * which no remainder equals when `each` is odd: such a strategy only ever sold.
 */
const getAdviceSide = (elapsed: number, each: number): OrderSide | undefined => {
  if (elapsed % each !== 0) return;
  return (elapsed / each) % 2 === 0 ? 'SELL' : 'BUY';
};

/**
 * This strategy is used for debugging purposes. It is used in e2e tests to verify the pipeline too, so be careful when modifying it.
 * From the candle `wait`, counted from 0 for the first candle after the warmup, it advises every `each` candles a STICKY order of 1
 * unit on every watched pair: a SELL first, then a BUY, and so on. It tracks no position: a SELL is advised whether the asset is held
 * or not.
 */
export class DebugAdvice implements Strategy<DebugAdviceParams> {
  static schema = debugAdviceStrategySchema;
  private index = 0;
  /** The index of the candle that cancels each order created while cancelAfter is set, by id, until the order ends */
  private cancelAt = new Map<UUID, number>();

  onTimeframeCandleAfterWarmup({ candle, tools }: OnCandleEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { strategyParams, log, createOrder, cancelOrder } = tools;
    const { each, wait, cancelAfter } = strategyParams;

    // Check for cancellations
    for (const [orderId, cancelAt] of this.cancelAt) {
      if (this.index < cancelAt) continue;
      log('debug', `Cancelling order ${orderId} at index ${this.index}`);
      cancelOrder(orderId);
      this.cancelAt.delete(orderId);
    }

    if (this.index >= wait) {
      const side = getAdviceSide(this.index - wait, each);
      for (const pair of candle.keys()) {
        log('debug', `Iteration: ${this.index} for ${pair}`);
        if (!side) continue;
        log('debug', `Trigger ${side === 'SELL' ? 'SHORT' : 'LONG'} for ${pair}`);
        const id = createOrder({ type: 'STICKY', side, amount: 1, symbol: pair });
        if (!isNil(cancelAfter)) this.cancelAt.set(id, this.index + cancelAfter);
      }
    }

    this.index++;
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { order, tools } = params;
    tools.log('debug', `Order Completed: ${order.id}`);
    this.cancelAt.delete(order.id);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { order, tools } = params;
    tools.log('debug', `Order Canceled: ${order.id}`);
    this.cancelAt.delete(order.id);
  }

  onOrderErrored(params: OnOrderErroredEventParams<DebugAdviceParams>, ..._indicators: unknown[]): void {
    const { order, tools } = params;
    tools.log('debug', `Order Errored: ${order.id}`);
    this.cancelAt.delete(order.id);
  }
}
