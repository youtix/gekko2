import { StrategyOrder } from '@models/advice.types';
import { UUID } from 'node:crypto';
import { OnOrderCanceledEventParams, OnOrderCompletedEventParams, OnOrderErroredEventParams, Strategy } from './strategy.types';

export type OrderOutcome = 'completed' | 'canceled' | 'errored';
/** A strategy's order hooks, or those of a PositionTracker */
type OrderHooks<T> = Pick<Strategy<T>, 'onOrderCompleted' | 'onOrderCanceled' | 'onOrderErrored'>;

/** The id of an order the strategy did not create, relayed by the step '<outcome>:unknown' */
export const UNKNOWN_ORDER_ID: UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * Stands in for tools.createOrder: records every order created, an all-in one (without amount) with amount 1, and gives the n-th
 * one the id 00000000-0000-0000-0000-00000000000n.
 */
export class OrderRecorder {
  readonly advices: StrategyOrder[] = [];
  readonly ids: UUID[] = [];

  readonly createOrder = (order: StrategyOrder): UUID => {
    this.advices.push({ ...order, amount: order.amount ?? 1 });
    const id = `00000000-0000-0000-0000-${String(this.advices.length).padStart(12, '0')}` as UUID;
    this.ids.push(id);
    return id;
  };
}

/** Relays the outcome of an order, known by its id alone, to the order hook; returns what the hook returns */
export const relayOrderOutcome = <T>(target: OrderHooks<T>, outcome: OrderOutcome, id: UUID): unknown => {
  const params = { order: { id } };
  switch (outcome) {
    case 'completed':
      return target.onOrderCompleted?.(params as unknown as OnOrderCompletedEventParams<T>);
    case 'canceled':
      return target.onOrderCanceled?.(params as unknown as OnOrderCanceledEventParams<T>);
    case 'errored':
      return target.onOrderErrored?.(params as unknown as OnOrderErroredEventParams<T>);
    default:
      throw new Error(`Unknown order outcome: ${outcome}`);
  }
};

/**
 * Plays the steps, separated by spaces: '<outcome>:<n>' relays the outcome (completed, canceled, errored) of the n-th order the
 * recorder gave an id, '<outcome>:unknown' that of an order the strategy did not create, and playStep plays any other step (a
 * candle).
 */
export const playSteps = <T>(steps: string, target: OrderHooks<T>, orders: OrderRecorder, playStep: (step: string) => void): void => {
  for (const step of steps.split(' ').filter(Boolean)) {
    const [kind, order] = step.split(':');
    if (!order) {
      playStep(kind);
      continue;
    }
    const id = order === 'unknown' ? UNKNOWN_ORDER_ID : orders.ids[Number(order) - 1];
    if (!id) throw new Error(`No order ${order} to relay the outcome of, in "${steps}"`);
    relayOrderOutcome(target, kind as OrderOutcome, id);
  }
};
