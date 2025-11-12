import { GekkoError } from '@errors/gekko.error';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { OrderSide, OrderState } from '@models/order.types';
import { Exchange } from '@services/exchange/exchange';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { warning } from '@services/logger';
import { bindAll } from 'lodash-es';
import { UUID } from 'node:crypto';
import { Order } from '../order';
import { createOrderSummary } from '../order.utils';

export class LimitOrder extends Order {
  public readonly creation: Promise<void>;

  private readonly price: number;
  private interval?: Timer;
  private checking: boolean;
  private completing: boolean;
  private id?: string;

  constructor(gekkoOrderId: UUID, side: OrderSide, amount: number, exchange: Exchange, price: number) {
    super(gekkoOrderId, exchange, side, 'LIMIT');
    this.price = price;
    this.checking = false;
    this.completing = false;

    bindAll(this, [this.checkOrder.name]);

    this.interval = setInterval(this.checkOrder, this.exchange.getInterval());

    this.creation = this.createLimitOrder(side, amount, price);
  }

  public async cancel() {
    if (this.isOrderCompleted()) {
      this.stopPolling();
      return;
    }

    this.completing = true;
    if (!this.id || this.getStatus() === 'initializing') return;

    await this.cancelOrder(this.id);
    if (this.getStatus() !== 'error') {
      this.stopPolling();
      this.completing = false;
    }
  }

  public async createSummary() {
    if (!this.isOrderCompleted()) throw new GekkoError('core', 'Order is not completed');

    return createOrderSummary({
      exchange: this.exchange,
      type: 'LIMIT',
      side: this.side,
      transactions: this.transactions,
    });
  }

  protected handleCreateOrderSuccess(order: OrderState) {
    this.applyOrderUpdate(order);
  }

  protected handleCreateOrderError(error: unknown) {
    this.stopPolling();

    if (error instanceof InvalidOrder || error instanceof OrderOutOfRangeError)
      return this.orderRejected(error.message);

    if (error instanceof Error) this.orderErrored(error);
    throw error;
  }

  protected handleCancelOrderSuccess(order: OrderState) {
    this.applyOrderUpdate(order);
  }

  protected handleCancelOrderError(error: unknown) {
    if (error instanceof OrderNotFound) {
      this.stopPolling();
      return this.orderFilled();
    }

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

  private async checkOrder() {
    if (this.isOrderCompleted()) {
      this.stopPolling();
      return;
    }

    if (!this.id || this.getStatus() === 'initializing' || this.checking || this.completing) return;

    this.checking = true;
    try {
      await this.fetchOrder(this.id);
    } finally {
      this.checking = false;
    }
  }

  private applyOrderUpdate(order: OrderState) {
    const { id, status, filled = 0, timestamp, remaining = 0 } = order;
    if (!id) return;

    this.id = id;
    const transaction = { id, timestamp, filled };
    const index = this.transactions.findIndex(t => t.id === id);
    if (index >= 0) this.transactions[index] = transaction;
    else this.transactions.push(transaction);

    if (filled) this.orderPartiallyFilled(id, filled);

    if (status === 'closed') {
      this.stopPolling();
      return this.orderFilled();
    }

    if (status === 'canceled') {
      this.stopPolling();
      return this.orderCanceled({ filled, remaining, price: this.price });
    }

    if (status === 'open') return this.setStatus('open');

    warning('core', `Order update returned unexpected status: ${status ?? 'unknown'}`);
  }

  private stopPolling() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private isOrderCompleted() {
    return ['rejected', 'canceled', 'filled'].includes(this.getStatus());
  }
}
