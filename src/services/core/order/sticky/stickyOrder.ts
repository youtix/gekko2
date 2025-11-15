import { GekkoError } from '@errors/gekko.error';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { OrderSide, OrderState } from '@models/order.types';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { debug, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { bindAll, sumBy } from 'lodash-es';
import { UUID } from 'node:crypto';
import { Order } from '../order';
import { createOrderSummary } from '../order.utils';

export class StickyOrder extends Order {
  private completing: boolean;
  private moving: boolean;
  private checking: boolean;
  private amount: number;
  private id?: string;

  constructor(gekkoOrderId: UUID, action: OrderSide, amount: number, _price?: number) {
    super(gekkoOrderId, action, 'STICKY');
    this.completing = false;
    this.moving = false;
    this.checking = false;
    this.amount = amount;

    bindAll(this, [this.checkOrder.name]);

    this.createStickyOrder();
  }

  private async createStickyOrder() {
    const { ask, bid } = await this.exchange.fetchTicker();

    const limits = this.exchange.getMarketLimits();
    const minimalPrice = limits?.price?.min ?? 0;

    const price = this.side === 'BUY' ? bid + minimalPrice : ask - minimalPrice;
    const filledAmount = sumBy(this.transactions.values().toArray(), 'filled');

    // Creating initial order
    this.createLimitOrder(this.side, this.amount - filledAmount, price);
  }

  public async cancel() {
    if (this.isOrderCompleted()) return;
    this.completing = true;
    if (this.checking || this.getStatus() === 'initializing') return;

    if (this.id) await this.cancelOrder(this.id);
    if (this.getStatus() !== 'error') this.completing = false;
  }

  public async createSummary() {
    if (!this.isOrderCompleted()) throw new GekkoError('core', 'Order is not completed');

    return createOrderSummary({
      exchange: this.exchange,
      type: 'STICKY',
      side: this.side,
      transactions: this.transactions.values().toArray(),
    });
  }

  public async checkOrder() {
    if (this.isOrderCompleted() || !this.id) return;
    debug('core', `Starting checking order ${this.id} status`);

    // If canceling execute cancel().
    if (this.completing) return await this.cancel();
    // No check when initializing the order or when already checking the order.
    if (this.getStatus() === 'initializing' || this.checking) return;
    this.checking = true;
    if (this.id) await this.fetchOrder(this.id);
    this.checking = false;
  }

  private async move() {
    debug('core', `Starting moving order ${this.id}`);

    // Ignoring move if cancel order has been given during checking
    if (this.completing || !this.id) return;
    this.moving = true;
    await this.cancelOrder(this.id);

    // If order cancelation is a success let's keep going the move
    if (this.getStatus() !== 'error' && !this.isOrderCompleted()) await this.createStickyOrder();

    this.moving = false;
  }

  private isOrderPartiallyFilled() {
    return !this.isOrderCompleted() && sumBy(this.transactions.values().toArray(), 'filled') > 0;
  }

  private isOrderCompleted() {
    return ['rejected', 'canceled', 'filled'].includes(this.getStatus());
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
      'core',
      [
        `Order ${id} created with success.`,
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

    if (status === 'closed') return Promise.resolve(this.orderFilled());

    if (filled) this.orderPartiallyFilled(id, filled);

    if (status === 'canceled') {
      const totalFilled = sumBy(this.transactions.values().toArray(), 'filled');
      const remainingAmount = Math.max(this.amount - totalFilled, 0);
      return Promise.resolve(this.orderCanceled({ filled: totalFilled, remaining: remainingAmount, timestamp }));
    }

    if (status === 'open') return Promise.resolve(this.setStatus('open'));
    warning('core', `Order creation succeeded, but unknown status (${status}) returned`);
    return Promise.resolve();
  }

  protected handleCreateOrderError(error: unknown) {
    if (error instanceof OrderOutOfRangeError && this.isOrderPartiallyFilled())
      return Promise.resolve(this.orderFilled());

    if (error instanceof InvalidOrder || error instanceof OrderOutOfRangeError)
      return Promise.resolve(this.orderRejected(error.message));

    if (error instanceof Error) this.orderErrored(error);

    throw error;
  }

  protected handleCancelOrderSuccess({ id, status, filled, remaining, timestamp, price }: OrderState) {
    debug(
      'core',
      [
        `Order ${id} canceled with success.`,
        `Order is moving: ${this.moving};`,
        `Status: ${status};`,
        `Filled: ${filled};`,
        `Price: ${price};`,
        `Remaining: ${remaining};`,
        `Timestamp: ${toISOString(timestamp)};`,
      ].join(' '),
    );

    const totalFilledOfAllTransactions = sumBy(this.transactions.values().toArray(), 'filled') + (filled ?? 0);
    if (remaining === 0 || this.amount === totalFilledOfAllTransactions) {
      return Promise.resolve(this.orderFilled());
    }

    this.updateTransactionPartialFilledAmount(id, filled);

    // No need to clear interval here, it will be done in cancel function
    if (!this.moving) {
      const remainingAmount = Math.max(this.amount - totalFilledOfAllTransactions, 0);
      this.orderCanceled({ filled: totalFilledOfAllTransactions, remaining: remainingAmount, timestamp });
    }
    return Promise.resolve();
  }

  protected handleCancelOrderError(error: Error) {
    // Order is not found because it was filled
    if (error instanceof OrderNotFound) {
      return Promise.resolve(this.orderFilled());
    }
    return Promise.resolve(this.orderErrored(error));
  }

  protected async handleFetchOrderSuccess({ id, status, filled, price, remaining, timestamp }: OrderState) {
    debug(
      'core',
      [
        `Order ${id} fetched with success.`,
        `Order is moving: ${this.moving};`,
        `Status: ${status};`,
        `Filled: ${filled};`,
        `Price: ${price};`,
        `Remaining: ${remaining};`,
        `Timestamp: ${toISOString(timestamp)};`,
      ].join(' '),
    );

    if (status === 'closed') {
      return Promise.resolve(this.orderFilled());
    }

    this.updateTransactionPartialFilledAmount(id, filled);

    if (status === 'canceled') {
      const totalFilled = sumBy(this.transactions.values().toArray(), 'filled');
      const remainingAmount = Math.max(this.amount - totalFilled, 0);
      return Promise.resolve(this.orderCanceled({ filled: totalFilled, remaining: remainingAmount, timestamp }));
    }

    if (status === 'open') {
      try {
        const ticker = await this.exchange.fetchTicker();
        const bookSide = this.side === 'BUY' ? 'bid' : 'ask';
        debug('core', `Moving order ${id} to ${bookSide} side ${ticker[bookSide]}. Old price: ${price}.`);

        if (price && ticker[bookSide] !== price) await this.move();
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
