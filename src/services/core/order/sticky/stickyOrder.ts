import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { OrderSide, OrderState } from '@models/order.types';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { debug, info, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { bindAll, sumBy } from 'lodash-es';
import { UUID } from 'node:crypto';
import { Order } from '../order';

export class StickyOrder extends Order {
  private isCanceling: boolean;
  private isMoving: boolean;
  private isChecking: boolean;
  private amount: number;
  private id?: string;
  private interval?: Timer;

  constructor(gekkoOrderId: UUID, action: OrderSide, amount: number, _price?: number) {
    super(gekkoOrderId, action, 'STICKY');
    const { orderSync } = this.exchange.getIntervals();
    this.isCanceling = false;
    this.isMoving = false;
    this.isChecking = false;
    this.amount = amount;

    bindAll(this, [this.checkOrder.name]);

    if (this.mode === 'realtime') this.interval = setInterval(this.checkOrder, orderSync);
  }

  public async launch(): Promise<void> {
    const price = await this.processStickyPrice();
    const filledAmount = sumBy(this.transactions.values().toArray(), 'filled');

    // Creating initial order
    this.createLimitOrder(this.side, this.amount - filledAmount, price);
  }

  public async cancel() {
    if (this.isOrderCompleted()) return;
    this.isCanceling = true;
    // Let's wait order creation or order checking before canceling
    if (!this.id || this.isChecking || this.getStatus() === 'initializing') return;

    await this.cancelOrder(this.id);
    if (this.getStatus() !== 'error') {
      clearInterval(this.interval);
      this.isCanceling = false;
    }
  }

  public async checkOrder() {
    if (this.isOrderCompleted() || !this.id) return;
    info('order', `[${this.gekkoOrderId}] Starting checking order status`);

    // If canceling execute cancel().
    if (this.isCanceling) return await this.cancel();
    // No check when initializing the order or when already checking the order.
    if (this.getStatus() === 'initializing' || this.isChecking) return;

    this.isChecking = true;
    try {
      await this.fetchOrder(this.id);
    } finally {
      this.isChecking = false;
    }
  }

  private async move() {
    debug('order', `[${this.gekkoOrderId}] Starting moving ${this.side} ${this.type} order`);

    // Ignoring move if cancel order has been given during checking
    if (this.isCanceling || !this.id) return;
    this.isMoving = true;
    await this.cancelOrder(this.id);

    // If order cancelation is a success let's keep going the move
    if (this.getStatus() !== 'error' && !this.isOrderCompleted()) await this.launch();

    this.isMoving = false;
  }

  private async processStickyPrice() {
    const { bid, ask } = await this.exchange.fetchTicker();
    const limits = this.exchange.getMarketLimits();
    const minimalPrice = limits?.price?.min ?? 0;
    return this.side === 'BUY' ? bid + minimalPrice : ask - minimalPrice;
  }

  private isOrderPartiallyFilled() {
    return !this.isOrderCompleted() && sumBy(this.transactions.values().toArray(), 'filled') > 0;
  }

  private updateTransactionPartialFilledAmount(id: string, filled = 0) {
    const transaction = this.transactions.get(id);
    const lastFilledValueOfCurrentTransaction = transaction?.filled ?? 0;
    if (transaction && filled > lastFilledValueOfCurrentTransaction) {
      this.transactions.set(id, { ...transaction, filled });
      this.orderPartiallyFilled(id, filled);
    }
  }

  // Overrided functions
  protected handleCreateOrderSuccess({ id, status, filled, price, remaining, timestamp }: OrderState) {
    debug(
      'order',
      [
        `[${this.gekkoOrderId}] ${this.side} ${this.type} order created with success.`,
        `Status: ${status};`,
        `Filled: ${filled};`,
        `Price: ${price};`,
        `Remaining: ${remaining};`,
        `Timestamp: ${toISOString(timestamp)};`,
      ].join(' '),
    );

    // Updating transactions
    this.transactions.set(id, { id, timestamp, filled, status });

    // Updating current transaction ID
    this.id = id;

    if (status === 'closed') {
      clearInterval(this.interval);
      return Promise.resolve(this.orderFilled());
    }

    if (filled) this.orderPartiallyFilled(id, filled);

    if (status === 'canceled') {
      clearInterval(this.interval);
      const totalFilled = sumBy(this.transactions.values().toArray(), 'filled');
      const remainingAmount = Math.max(this.amount - totalFilled, 0);
      return Promise.resolve(this.orderCanceled({ filled: totalFilled, remaining: remainingAmount, timestamp }));
    }

    if (status === 'open') return Promise.resolve(this.setStatus('open'));
    warning('order', `[${this.gekkoOrderId}] Order creation succeeded, but unknown status (${status}) returned`);
    return Promise.resolve();
  }

  protected handleCreateOrderError(error: unknown) {
    clearInterval(this.interval);
    if (error instanceof OrderOutOfRangeError && this.isOrderPartiallyFilled())
      return Promise.resolve(this.orderFilled());

    if (error instanceof InvalidOrder || error instanceof OrderOutOfRangeError)
      return Promise.resolve(this.orderRejected(error.message));

    if (error instanceof Error) this.orderErrored(error);

    throw error;
  }

  protected handleCancelOrderSuccess({ id, status, filled, remaining, timestamp, price }: OrderState) {
    debug(
      'order',
      [
        `[${this.gekkoOrderId}] ${this.side} ${this.type} order canceled with success.`,
        `Order is moving: ${this.isMoving};`,
        `Status: ${status};`,
        `Filled: ${filled};`,
        `Price: ${price};`,
        `Remaining: ${remaining};`,
        `Timestamp: ${toISOString(timestamp)};`,
      ].join(' '),
    );

    const totalFilledOfAllTransactions = sumBy(this.transactions.values().toArray(), 'filled') + (filled ?? 0);
    if (remaining === 0 || this.amount === totalFilledOfAllTransactions) {
      clearInterval(this.interval);
      return Promise.resolve(this.orderFilled());
    }

    this.updateTransactionPartialFilledAmount(id, filled);

    // No need to clear interval here, it will be done in cancel function
    if (!this.isMoving) {
      const remainingAmount = Math.max(this.amount - totalFilledOfAllTransactions, 0);
      this.orderCanceled({ filled: totalFilledOfAllTransactions, remaining: remainingAmount, timestamp });
    }
    return Promise.resolve();
  }

  protected handleCancelOrderError(error: Error) {
    // Order is not found because it was filled
    if (error instanceof OrderNotFound) {
      clearInterval(this.interval);
      return Promise.resolve(this.orderFilled());
    }
    return Promise.resolve(this.orderErrored(error));
  }

  protected async handleFetchOrderSuccess({ id, status, filled, price, remaining, timestamp }: OrderState) {
    debug(
      'order',
      [
        `[${this.gekkoOrderId}] ${this.side} ${this.type} order data:`,
        `Order moved: ${this.isMoving};`,
        `Status: ${status.toUpperCase()};`,
        `Filled: ${filled};`,
        `Price: ${price};`,
        `Remaining: ${remaining};`,
        `Timestamp: ${toISOString(timestamp)};`,
      ].join(' '),
    );

    if (status === 'closed') {
      clearInterval(this.interval);
      return Promise.resolve(this.orderFilled());
    }

    this.updateTransactionPartialFilledAmount(id, filled);

    if (status === 'canceled') {
      clearInterval(this.interval);
      const totalFilled = sumBy(this.transactions.values().toArray(), 'filled');
      const remainingAmount = Math.max(this.amount - totalFilled, 0);
      return Promise.resolve(this.orderCanceled({ filled: totalFilled, remaining: remainingAmount, timestamp }));
    }

    if (status === 'open') {
      try {
        const newPrice = await this.processStickyPrice();
        if (price && newPrice !== price) {
          const msg = `[${this.gekkoOrderId}] Moving ${this.side} ${this.type} order from price: ${price} to ${newPrice} price.`;
          debug('order', msg);
          await this.move();
        }
      } catch (error) {
        if (error instanceof Error) this.orderErrored(error);
        throw error;
      }
    }
    return Promise.resolve();
  }

  protected handleFetchOrderError(error: Error) {
    return Promise.resolve(this.orderErrored(error));
  }
}
