import { OrderOutOfRangeError } from '@errors/broker/OrderOutRange.error';
import { Action } from '@models/types/action.types';
import { Order } from '@models/types/order.types';
import { Broker } from '@services/broker/broker';
import { logger } from '@services/logger';
import Big from 'big.js';
import { InvalidOrder } from 'ccxt';
import { bindAll, remove, sumBy } from 'lodash-es';
import { BaseOrder } from '../base/baseOrder';
import { INVALID_ORDER_EVENT } from '../base/baseOrder.const';

export class StickyOrder extends BaseOrder {
  private completing: boolean;
  private moving: boolean;
  private checking: boolean;
  private side: Action;
  private amount: number;
  private id?: string;
  private interval?: Timer;

  constructor(action: Action, amount: number, broker: Broker) {
    super(broker);
    const filledAmount = sumBy(this.transactions, 'filled');
    this.createOrder(action, +Big(amount).minus(filledAmount));
    this.completing = false;
    this.moving = false;
    this.checking = false;
    this.side = action;
    this.amount = amount;
    bindAll(this, ['checkOrder']);
    this.interval = setInterval(this.checkOrder, this.broker.getInterval());
  }

  private async checkOrder() {
    if (this.getStatus() !== 'initializing' && !this.id) throw new Error(); // TODO
    if (this.isOrderCompleted() || this.moving || this.checking) return;
    if (this.completing) return await this.cancel();
    this.checking = true;
    if (this.id) await this.fetchOrder(this.id);
    this.checking = false;
  }

  public async cancel() {
    if (this.isOrderCompleted()) return;
    this.completing = true;
    if (this.moving || this.checking) return;

    if (!this.id) throw new Error(); // TODO
    await this.cancelOrder(this.id);
    this.completing = false;
  }

  private async move() {
    if (!this.id) throw new Error(); // TODO
    if (this.isOrderCompleted() || this.completing) return;
    this.moving = true;
    await this.cancelOrder(this.id);
    if (this.getStatus() !== 'error') {
      const filledAmount = sumBy(this.transactions, 'filled');
      await this.createOrder(this.side, +Big(this.amount).minus(filledAmount));
    }
    this.moving = false;
  }

  private isOrderPartiallyFilled() {
    return !this.isOrderCompleted() && sumBy(this.transactions, 'filled') > 0;
  }

  private isOrderCompleted() {
    return ['rejected', 'canceled', 'filled'].includes(this.getStatus());
  }

  protected handleCreateOrderSuccess({ id, status, filled, price }: Order) {
    remove(this.transactions, (t) => t.id === this.id && t.filled === 0);
    logger.debug(`[ORDER] ${this.side} old id: ${this.id} new id: ${id}`);
    this.id = id;
    this.transactions = [...this.transactions, { id, price, filled }];

    if (status === 'closed') {
      return this.orderFilled();
    }

    if (filled) this.orderPartiallyFilled(id, filled);
    if (status === 'canceled') {
      return this.orderCanceled(!!filled);
    }

    if (status === 'open') return this.setStatus('open');
    logger.warn(`[ORDER] Order creation succeeded, but unknown status (${status}) returned`);
  }

  protected handleCreateOrderError(error: unknown) {
    if (error instanceof OrderOutOfRangeError && this.isOrderPartiallyFilled())
      return this.orderFilled();

    if (error instanceof InvalidOrder || error instanceof OrderOutOfRangeError) {
      this.emit(INVALID_ORDER_EVENT, error.message);
      return this.orderRejected(error.message);
    }

    if (error instanceof Error) this.orderErrored(error);
    throw error;
  }

  protected handleCancelOrderSuccess({ id, filled, remaining }: Order) {
    const filledAmount = sumBy(this.transactions, 'filled');
    if (remaining === 0 || filled === filledAmount) {
      return this.orderFilled();
    }
    if (filled && filled > filledAmount) this.orderPartiallyFilled(id, filled);
    if (!this.moving) {
      this.orderCanceled(!!filled || !!filledAmount);
    }
  }

  protected handleCancelOrderError(error: Error) {
    this.orderErrored(error);
  }

  protected async handleFetchOrderSuccess({ id, status, filled, price }: Order) {
    if (status === 'closed') {
      return this.orderFilled();
    }

    const filledAmount = sumBy(this.transactions, 'filled');
    if (filled && filled > filledAmount) this.orderPartiallyFilled(id, filled);

    if (status === 'canceled') {
      return this.orderCanceled(!!filled);
    }

    if (status === 'open') {
      try {
        const ticker = await this.broker.fetchTicker();
        const bookSide = this.side === 'buy' ? 'bid' : 'ask';
        if (price && ticker[bookSide] !== price) await this.move();
      } catch (error) {
        if (error instanceof Error) this.orderErrored(error);
        throw error;
      }
    }
    this.checking = false;
  }

  protected handleFetchOrderError(error: Error) {
    this.orderErrored(error);
  }
}
