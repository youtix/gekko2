import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
} from '@constants/event.const';
import { OrderSide, OrderState, OrderType } from '@models/order.types';
import { Exchange } from '@services/exchange/exchange';
import { debug, error, info } from '@services/logger';
import { UUID } from 'node:crypto';
import EventEmitter from 'node:events';
import { OrderStatus, OrderSummary, Transaction } from './order.types';

export abstract class Order extends EventEmitter {
  private status: OrderStatus;
  protected exchange: Exchange;
  protected transactions: Transaction[];
  protected readonly type: OrderType;
  protected readonly side: OrderSide;
  protected readonly gekkoOrderId: UUID;

  constructor(gekkoOrderId: UUID, exchange: Exchange, side: OrderSide, type: OrderType) {
    super();
    this.exchange = exchange;
    this.status = 'initializing';
    this.transactions = [];
    this.type = type;
    this.side = side;
    this.gekkoOrderId = gekkoOrderId;
  }

  public getGekkoOrderId() {
    return this.gekkoOrderId;
  }

  public getSide() {
    return this.side;
  }

  public getType() {
    return this.type;
  }

  protected async createLimitOrder(action: OrderSide, amount: number, price: number) {
    try {
      debug('core', `Creating ${action} limit order with amount: ${amount} with price ${price}`);
      const order = await this.exchange.createLimitOrder(action, amount, price);
      await this.handleCreateOrderSuccess(order);
    } catch (error) {
      await this.handleCreateOrderError(error);
    }
  }

  protected async createMarketOrder(action: OrderSide, amount: number) {
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
      debug('core', `Canceling ${this.type} order with ID: ${id}`);
      const order = await this.exchange.cancelOrder(id);
      await this.handleCancelOrderSuccess(order);
    } catch (error) {
      await this.handleCancelOrderError(error);
    }
  }

  protected async fetchOrder(id: string) {
    try {
      debug('core', `Fetching ${this.type} order with ID: ${id}`);
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
    this.emit(ORDER_STATUS_CHANGED_EVENT, { status, reason });
    if (reason) error('core', `${this.type} order ${status}: ${reason}`);
    else info('core', `${this.type} order ${status}`);
  }

  protected orderCanceled(partiallyFilled = false) {
    this.setStatus('canceled');
    this.emit(ORDER_CANCELED_EVENT, { status: this.status, partiallyFilled });
  }

  protected orderRejected(reason: string) {
    this.setStatus('rejected', reason);
    this.emit(ORDER_INVALID_EVENT, { status: this.status, filled: false, reason });
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

  public abstract cancel(): Promise<void>;
  public abstract createSummary(): Promise<OrderSummary>;

  protected abstract handleCancelOrderSuccess(order: OrderState): void;
  protected abstract handleCancelOrderError(error: unknown): void;
  protected abstract handleCreateOrderSuccess(order: OrderState): void;
  protected abstract handleCreateOrderError(error: unknown): void;
  protected abstract handleFetchOrderSuccess(order: OrderState): void;
  protected abstract handleFetchOrderError(error: unknown): void;
}
