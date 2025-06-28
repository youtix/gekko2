import { Action } from '@models/types/action.types';
import { Order } from '@models/types/order.types';
import { Broker } from '@services/broker/broker';
import { debug, error, info } from '@services/logger';
import EventEmitter from 'node:events';
import {
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
} from './baseOrder.const';
import { OrderStatus, Transaction } from './baseOrder.types';

export abstract class BaseOrder extends EventEmitter {
  private status: OrderStatus;
  protected broker: Broker;
  protected transactions: Transaction[];

  constructor(broker: Broker) {
    super();
    this.broker = broker;
    this.status = 'initializing';
    this.transactions = [];
  }

  protected async createOrder(action: Action, amount: number) {
    try {
      debug('core', `Creating ${action} limit order with amount: ${amount}`);
      const order = await this.broker.createLimitOrder(action, amount);
      await this.handleCreateOrderSuccess(order);
    } catch (error) {
      await this.handleCreateOrderError(error);
    }
  }

  protected async cancelOrder(id: string) {
    try {
      debug('core', `Canceling order with ID: ${id}`);
      const order = await this.broker.cancelLimitOrder(id);
      await this.handleCancelOrderSuccess(order);
    } catch (error) {
      await this.handleCancelOrderError(error);
    }
  }

  protected async fetchOrder(id: string) {
    try {
      debug('core', `Fetching order with ID: ${id}`);
      const order = await this.broker.fetchOrder(id);
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
    if (reason) error('core', `Sticky order ${status}: ${reason}`);
    else info('core', `Sticky order ${status}`);
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

  protected abstract handleCancelOrderSuccess(order: Order): void;
  protected abstract handleCancelOrderError(error: unknown): void;
  protected abstract handleCreateOrderSuccess(order: Order): void;
  protected abstract handleCreateOrderError(error: unknown): void;
  protected abstract handleFetchOrderSuccess(order: Order): void;
  protected abstract handleFetchOrderError(error: unknown): void;
}
