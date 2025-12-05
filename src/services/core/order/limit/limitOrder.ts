import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { OrderSide, OrderState } from '@models/order.types';
import { config } from '@services/configuration/configuration';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { debug, warning } from '@services/logger';
import { bindAll } from 'lodash-es';
import { UUID } from 'node:crypto';
import { Order } from '../order';

export class LimitOrder extends Order {
  private readonly price: number;
  private readonly amount: number;
  private isChecking: boolean;
  private isCanceling: boolean;
  private interval?: Timer;
  private id?: string;

  constructor(gekkoOrderId: UUID, side: OrderSide, amount: number, price: number) {
    super(gekkoOrderId, side, 'LIMIT');
    const orderSync = config.getExchange().orderSynchInterval;
    this.price = price;
    this.amount = amount;
    this.isChecking = false;
    this.isCanceling = false;

    bindAll(this, [this.checkOrder.name]);

    if (this.mode === 'realtime') this.interval = setInterval(this.checkOrder, orderSync);
  }

  public async launch(): Promise<void> {
    await this.createLimitOrder(this.side, this.amount, this.price);
  }

  public async cancel() {
    if (this.isOrderCompleted()) {
      clearInterval(this.interval);
      return;
    }

    this.isCanceling = true;
    if (!this.id || this.getStatus() === 'initializing') return;

    await this.cancelOrder(this.id);
    if (this.getStatus() !== 'error') {
      clearInterval(this.interval);
      this.isCanceling = false;
    }
  }

  public async checkOrder() {
    if (this.isOrderCompleted()) clearInterval(this.interval);
    if (this.isOrderCompleted() || !this.id || this.getStatus() === 'initializing' || this.isChecking) return;
    debug('order', `[${this.gekkoOrderId}] Starting checking ${this.side} ${this.type} order status`);

    // If canceling execute cancel().
    if (this.isCanceling) return await this.cancel();

    this.isChecking = true;
    try {
      await this.fetchOrder(this.id);
    } finally {
      this.isChecking = false;
    }
  }

  protected handleCreateOrderSuccess(order: OrderState) {
    this.applyOrderUpdate(order);
  }

  protected handleCreateOrderError(error: unknown) {
    clearInterval(this.interval);

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
      clearInterval(this.interval);
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

  private applyOrderUpdate(order: OrderState) {
    const { id, status, filled = 0, timestamp, remaining = 0 } = order;

    if (!id) return;

    const oldTransaction = this.transactions.get(id);

    this.id = id;
    this.transactions.set(id, { id, timestamp, filled, status });

    if (filled) this.orderPartiallyFilled(id, filled);

    switch (status) {
      case 'closed':
        clearInterval(this.interval);
        return this.orderFilled();
      case 'canceled':
        clearInterval(this.interval);
        return this.orderCanceled({ filled, remaining, price: this.price, timestamp });
      case 'open':
        if (oldTransaction?.status !== status) return this.setStatus('open');
        break;
      default:
        warning(
          'order',
          `[${this.gekkoOrderId}] ${this.side} ${this.type} order update returned unexpected status: ${status ?? 'unknown'}`,
        );
    }
  }
}
