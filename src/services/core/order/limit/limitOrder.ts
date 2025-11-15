import { GekkoError } from '@errors/gekko.error';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { OrderSide, OrderState } from '@models/order.types';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { debug, warning } from '@services/logger';
import { bindAll } from 'lodash-es';
import { UUID } from 'node:crypto';
import { Order } from '../order';
import { createOrderSummary } from '../order.utils';

export class LimitOrder extends Order {
  public readonly creation: Promise<void>;
  private readonly price: number;
  private checking: boolean;
  private completing: boolean;
  private id?: string;

  constructor(gekkoOrderId: UUID, side: OrderSide, amount: number, price: number) {
    super(gekkoOrderId, side, 'LIMIT');
    this.price = price;
    this.checking = false;
    this.completing = false;

    bindAll(this, [this.checkOrder.name]);

    this.creation = this.createLimitOrder(side, amount, price);
  }

  public async cancel() {
    if (this.isOrderCompleted()) return;

    this.completing = true;
    if (!this.id || this.getStatus() === 'initializing') return;

    await this.cancelOrder(this.id);
    if (this.getStatus() !== 'error') this.completing = false;
  }

  public async createSummary() {
    if (!this.isOrderCompleted()) throw new GekkoError('core', 'Order is not completed');

    return createOrderSummary({
      exchange: this.exchange,
      type: 'LIMIT',
      side: this.side,
      transactions: this.transactions.values().toArray(),
    });
  }

  public async checkOrder() {
    if (this.isOrderCompleted() || !this.id || this.getStatus() === 'initializing' || this.checking || this.completing)
      return;
    debug('core', `Starting checking order ${this.id} status`);

    this.checking = true;
    try {
      await this.fetchOrder(this.id);
    } finally {
      this.checking = false;
    }
  }

  protected handleCreateOrderSuccess(order: OrderState) {
    this.applyOrderUpdate(order);
  }

  protected handleCreateOrderError(error: unknown) {
    if (error instanceof InvalidOrder || error instanceof OrderOutOfRangeError)
      return this.orderRejected(error.message);

    if (error instanceof Error) this.orderErrored(error);
    throw error;
  }

  protected handleCancelOrderSuccess(order: OrderState) {
    this.applyOrderUpdate(order);
  }

  protected handleCancelOrderError(error: unknown) {
    if (error instanceof OrderNotFound) return this.orderFilled();

    if (error instanceof Error) this.orderErrored(error);
    throw error;
  }

  protected handleFetchOrderSuccess(order: OrderState) {
    this.applyOrderUpdate(order);
  }

  protected handleFetchOrderError(error: unknown) {
    if (error instanceof Error) this.orderErrored(error);
    throw error;
  }

  private applyOrderUpdate(order: OrderState) {
    const { id, status, filled = 0, timestamp, remaining = 0 } = order;

    if (!id) return;

    const oldTransaction = this.transactions.get(id);

    this.id = id;
    this.transactions.set(id, { id, timestamp, filled, status });

    if (filled) this.orderPartiallyFilled(id, filled);

    switch (status) {
      case 'closed':
        return this.orderFilled();
      case 'canceled':
        return this.orderCanceled({ filled, remaining, price: this.price, timestamp });
      case 'open':
        if (oldTransaction?.status !== status) return this.setStatus('open');
        break;
      default:
        warning('core', `Order update returned unexpected status: ${status ?? 'unknown'}`);
    }
  }

  private isOrderCompleted() {
    return ['rejected', 'canceled', 'filled'].includes(this.getStatus());
  }
}
