import { Action } from '@models/action.types';
import { OrderState, OrderType } from '@models/order.types';
import { Exchange } from '@services/exchange/exchange';
import { debug, error, info } from '@services/logger';
import EventEmitter from 'node:events';
import {
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
} from './order.const';
import { OrderStatus, Transaction } from './order.types';

export abstract class Order extends EventEmitter {
  private status: OrderStatus;
  protected exchange: Exchange;
  protected transactions: Transaction[];
  protected readonly label: OrderType;

  constructor(exchange: Exchange, label: OrderType) {
    super();
    this.exchange = exchange;
    this.status = 'initializing';
    this.transactions = [];
    this.label = label;
  }

  protected async createLimitOrder(action: Action, amount: number) {
    try {
      debug('core', `Creating ${action} limit order with amount: ${amount}`);
      const order = await this.exchange.createLimitOrder(action, amount);
      await this.handleCreateOrderSuccess(order);
    } catch (error) {
      await this.handleCreateOrderError(error);
    }
  }

  protected async createMarketOrder(action: Action, amount: number) {
    try {
      debug('core', `Creating ${action} market order with amount: ${amount}`);
      const order = await this.exchange.createMarketOrder(action, amount);
      await this.handleCreateOrderSuccess(order);
    } catch (error) {
      await this.handleCreateOrderError(error);
    }
  }

  protected async cancelOrder(id: string) {
    try {
      debug('core', `Canceling ${this.label} order with ID: ${id}`);
      const order = await this.exchange.cancelOrder(id);
      await this.handleCancelOrderSuccess(order);
    } catch (error) {
      await this.handleCancelOrderError(error);
    }
  }

  protected async fetchOrder(id: string) {
    try {
      debug('core', `Fetching ${this.label} order with ID: ${id}`);
      const order = await this.exchange.fetchOrder(id);
      await this.handleFetchOrderSuccess(order);
    } catch (error) {
      await this.handleFetchOrderError(error);
    }
  }

  protected getStatus() {
    return this.status;
  }

  protected setStatus(status: OrderStatus, reason?: string) {
    this.status = status;
    this.emit(ORDER_STATUS_CHANGED_EVENT, this.status);
    if (reason) error('core', `${this.label} order ${status}: ${reason}`);
    else info('core', `${this.label} order ${status}`);
  }

  protected orderCanceled(partiallyFilled = false) {
    this.setStatus('canceled');
    this.emit(ORDER_COMPLETED_EVENT, { status: this.status, partiallyFilled });
  }

  protected orderRejected(reason: string) {
    this.emit(ORDER_INVALID_EVENT, reason);
    this.setStatus('rejected', reason);
    this.emit(ORDER_COMPLETED_EVENT, { status: this.status, filled: false });
  }

  protected orderPartiallyFilled(orderId: string, filled: number) {
    this.emit(ORDER_PARTIALLY_FILLED_EVENT, filled);
    this.transactions = this.transactions.map(t => (t.id === orderId ? { ...t, filled } : t));
  }

  protected orderFilled() {
    this.setStatus('filled');
    this.emit(ORDER_COMPLETED_EVENT, { status: this.status, filled: true });
  }

  protected orderErrored(error: Error) {
    this.setStatus('error', error.message);
    this.emit(ORDER_ERRORED_EVENT, error.message);
  }

  protected abstract handleCancelOrderSuccess(order: OrderState): void;
  protected abstract handleCancelOrderError(error: unknown): void;
  protected abstract handleCreateOrderSuccess(order: OrderState): void;
  protected abstract handleCreateOrderError(error: unknown): void;
  protected abstract handleFetchOrderSuccess(order: OrderState): void;
  protected abstract handleFetchOrderError(error: unknown): void;
}
