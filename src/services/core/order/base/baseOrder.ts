import { Action } from '@models/types/action.types';
import { Order } from '@models/types/order.types';
import { Broker } from '@services/broker/broker';
import { logger } from '@services/logger';
import EventEmitter from 'node:events';
import { PARTIAL_FILL_EVENT } from '../sticky/stickyOrder.const';
import { COMPLETED_EVENT, STATUS_CHANGE_EVENT } from './baseOrder.const';
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
      logger.debug(`[ORDER] Creating ${action} limit order`);
      const order = await this.broker.createLimitOrder(action, amount);
      this.handleCreateOrderSuccess(order);
    } catch (error) {
      this.handleCreateOrderError(error);
    }
  }

  protected async cancelOrder(id: string) {
    try {
      logger.debug(`[ORDER] Canceling order with ID: ${id}`);
      const order = await this.broker.cancelLimitOrder(id);
      this.handleCancelOrderSuccess(order);
    } catch (error) {
      this.handleCancelOrderError(error);
    }
  }

  protected async fetchOrder(id: string) {
    try {
      logger.debug(`[ORDER] Fetching order with ID: ${id}`);
      const order = await this.broker.fetchOrder(id);
      this.handleFetchOrderSuccess(order);
    } catch (error) {
      this.handleFetchOrderError(error);
    }
  }

  protected getStatus() {
    return this.status;
  }

  protected setStatus(status: OrderStatus, reason?: string) {
    this.status = status;
    this.emit(STATUS_CHANGE_EVENT, this.status);
    if (reason) logger.error(`[ORDER] Sticky order ${status}: ${reason}`);
    else logger.info(`[ORDER] sticky order ${status}`);
  }

  protected orderCanceled(partiallyFilled = false) {
    this.setStatus('canceled');
    this.emit(COMPLETED_EVENT, { status: this.status, partiallyFilled });
  }

  protected orderRejected(reason: string) {
    this.setStatus('rejected', reason);
    this.emit(COMPLETED_EVENT, { status: this.status, filled: false });
  }

  protected orderPartiallyFilled(orderId: string, filled: number) {
    this.emit(PARTIAL_FILL_EVENT, filled);
    this.transactions = this.transactions.map((t) => (t.id === orderId ? { ...t, filled } : t));
  }

  protected orderFilled() {
    this.setStatus('filled');
    this.emit(COMPLETED_EVENT, { status: this.status, filled: true });
  }

  protected orderErrored(error: Error) {
    this.setStatus('error', error.message);
    this.emit('error', error);
  }

  protected abstract handleCancelOrderSuccess(order: Order): void;
  protected abstract handleCancelOrderError(error: unknown): void;
  protected abstract handleCreateOrderSuccess(order: Order): void;
  protected abstract handleCreateOrderError(error: unknown): void;
  protected abstract handleFetchOrderSuccess(order: Order): void;
  protected abstract handleFetchOrderError(error: unknown): void;
}
