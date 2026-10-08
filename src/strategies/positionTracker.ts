import { StrategyOrder } from '@models/advice.types';
import { OrderSide } from '@models/order.types';
import { UUID } from 'node:crypto';
import { OnOrderCanceledEventParams, OnOrderCompletedEventParams, OnOrderErroredEventParams, Tools } from './strategy.types';

/**
 * The position of a strategy that trades all-in: flat or long, and its own orders whose outcome has not come yet. Gekko 2 relays
 * every advice, so a strategy advising on every candle of a trend placed an all-in order sized from what the previous one left,
 * then had it refused until maxConsecutiveErrors stopped the bot: the strategy buys only when flat and sells only when long, never
 * while an order of its own is pending, and this is the bookkeeping that tells it which.
 *
 * - It starts flat: a holding present at start-up is sold only by the first SELL after a BUY.
 * - A completed BUY makes it long, a completed SELL flat.
 * - A canceled or errored order leaves the position as it was before it. What a canceled order filled is still held: the next
 *   all-in order completes it (a BUY spends the rest, a SELL sells everything).
 * - The outcome of an order that is not its own changes nothing, and an order counts once: its first outcome settles it.
 *
 * The strategy places its orders through buy and sell once canBuy or canSell allows it, and hands the params of its three order
 * hooks over as it gets them.
 */
export class PositionTracker {
  private long = false;
  // Not one id per side: the SELL of a trailing stop (adoptSell) can pend beside a SELL of the strategy's own
  private readonly pendingOrders = new Map<UUID, OrderSide>();

  /** Whether the last of its orders to complete was a BUY */
  get isLong(): boolean {
    return this.long;
  }

  /** Whether an order of its own still waits for its outcome */
  get isPendingOrder(): boolean {
    return this.pendingOrders.size > 0;
  }

  /** Flat, and nothing pending */
  canBuy(): boolean {
    return !this.long && !this.isPendingOrder;
  }

  /** Long, and nothing pending */
  canSell(): boolean {
    return this.long && !this.isPendingOrder;
  }

  /** Creates the order as a BUY through createOrder and keeps it pending until its outcome; returns its id */
  buy(createOrder: Tools<unknown>['createOrder'], order: Omit<StrategyOrder, 'side'>): UUID {
    const id = createOrder({ ...order, side: 'BUY' });
    this.pendingOrders.set(id, 'BUY');
    return id;
  }

  /** Creates the order as a SELL through createOrder and keeps it pending until its outcome; returns its id */
  sell(createOrder: Tools<unknown>['createOrder'], order: Omit<StrategyOrder, 'side' | 'trailing'>): UUID {
    const id = createOrder({ ...order, side: 'SELL' });
    this.adoptSell(id);
    return id;
  }

  /**
   * Keeps pending, as sell does, a SELL the strategy did not create itself: the one a trailing stop sends when it triggers. A
   * strategy whose BUYs carry a stop adopts it from `onTrailingStopTriggered(orderId, …)`; left out, the stop's SELL is not its own,
   * its outcome changes nothing, and once the stop has sold everything the strategy stays long, every SELL it advises refused.
   */
  adoptSell(orderId: UUID): void {
    this.pendingOrders.set(orderId, 'SELL');
  }

  /** Settles its own order that completed; returns whether the order was its own */
  onOrderCompleted({ order }: OnOrderCompletedEventParams<unknown>): boolean {
    const side = this.pendingOrders.get(order.id);
    if (!side) return false;
    this.pendingOrders.delete(order.id);
    this.long = side === 'BUY';
    return true;
  }

  /** Settles its own order that was canceled, the position unchanged; returns whether the order was its own */
  onOrderCanceled({ order }: OnOrderCanceledEventParams<unknown>): boolean {
    return this.pendingOrders.delete(order.id);
  }

  /** Settles its own order that errored, the position unchanged; returns whether the order was its own */
  onOrderErrored({ order }: OnOrderErroredEventParams<unknown>): boolean {
    return this.pendingOrders.delete(order.id);
  }
}
