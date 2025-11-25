import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { Watch } from '@models/configuration.types';
import { OrderSide, OrderState, OrderType } from '@models/order.types';
import { config } from '@services/configuration/configuration';
import { Exchange } from '@services/exchange/exchange';
import { inject } from '@services/injecter/injecter';
import { debug, error, info } from '@services/logger';
import { isNil } from 'lodash-es';
import { UUID } from 'node:crypto';
import EventEmitter from 'node:events';
import { OrderCancelDetails, OrderCancelEventPayload, OrderStatus, OrderSummary, Transaction } from './order.types';
import { createOrderSummary } from './order.utils';

export abstract class Order extends EventEmitter {
  private status: OrderStatus;
  protected readonly transactions: Map<string, Transaction>;
  protected readonly exchange: Exchange;
  protected readonly type: OrderType;
  protected readonly side: OrderSide;
  protected readonly gekkoOrderId: UUID;
  protected readonly mode: Watch['mode'];

  constructor(gekkoOrderId: UUID, side: OrderSide, type: OrderType) {
    super();
    const { mode } = config.getWatch();
    this.exchange = inject.exchange();
    this.status = 'initializing';
    this.transactions = new Map();
    this.type = type;
    this.side = side;
    this.gekkoOrderId = gekkoOrderId;
    this.mode = mode;
  }

  public getGekkoOrderId() {
    return this.gekkoOrderId;
  }

  protected async createLimitOrder(side: OrderSide, amount: number, price: number) {
    try {
      info('order', `[${this.gekkoOrderId}] Creating ${side} limit order with amount: ${amount} and price ${price}`);
      const order = await this.exchange.createLimitOrder(side, amount, price);
      await this.handleCreateOrderSuccess(order);
    } catch (error) {
      await this.handleCreateOrderError(error);
    }
  }

  protected async createMarketOrder(side: OrderSide, amount: number) {
    try {
      info('order', `[${this.gekkoOrderId}] Creating ${side} market order created with amount: ${amount}`);
      const order = await this.exchange.createMarketOrder(side, amount);
      await this.handleCreateOrderSuccess(order);
    } catch (error) {
      await this.handleCreateOrderError(error);
    }
  }

  protected async cancelOrder(id: string) {
    try {
      info('order', `[${this.gekkoOrderId}] Canceling ${this.side} ${this.type} order.`);
      const order = await this.exchange.cancelOrder(id);
      await this.handleCancelOrderSuccess(order);
    } catch (error) {
      await this.handleCancelOrderError(error);
    }
  }

  protected async fetchOrder(id: string) {
    try {
      info('order', `[${this.gekkoOrderId}] Fetching ${this.side} ${this.type} order`);
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
    if (reason) error('order', `[${this.gekkoOrderId}] ${this.side} ${this.type} order ${status}: ${reason}`);
    else debug('order', `[${this.gekkoOrderId}] ${this.side} ${this.type} order ${status}`);
  }

  protected orderCanceled({ filled, remaining, price, timestamp }: OrderCancelDetails) {
    this.setStatus('canceled');
    this.emit<OrderCancelEventPayload>(ORDER_CANCELED_EVENT, {
      status: this.status,
      ...(!isNil(filled) && { filled }),
      ...(!isNil(remaining) && { remaining }),
      ...(!isNil(price) && { price }),
      timestamp,
    });
  }

  protected orderRejected(reason: string) {
    this.setStatus('rejected', reason);
    this.emit(ORDER_INVALID_EVENT, { status: this.status, filled: false, reason });
  }

  protected orderPartiallyFilled(orderId: string, filled: number) {
    this.emit(ORDER_PARTIALLY_FILLED_EVENT, filled);
    const oldOrder = this.transactions.get(orderId);
    if (oldOrder) this.transactions.set(orderId, { ...oldOrder, filled });
  }

  protected orderFilled() {
    this.setStatus('filled');
    this.emit(ORDER_COMPLETED_EVENT, { status: this.status, filled: true });
  }

  protected orderErrored(error: Error) {
    this.setStatus('error', error.message);
    this.emit(ORDER_ERRORED_EVENT, error.message);
  }

  protected isOrderCompleted() {
    return ['rejected', 'canceled', 'filled'].includes(this.getStatus());
  }

  public async createSummary(): Promise<OrderSummary> {
    if (!this.isOrderCompleted())
      throw new GekkoError('order', `[${this.gekkoOrderId}] ${this.side} ${this.type} order is not completed`);

    return createOrderSummary({
      id: this.gekkoOrderId,
      exchange: this.exchange,
      type: this.type,
      side: this.side,
      transactions: this.transactions.values().toArray(),
    });
  }

  public abstract cancel(): Promise<void>;
  public abstract checkOrder(): Promise<void>;
  public abstract launch(): Promise<void>;

  protected abstract handleCancelOrderSuccess(order: OrderState): void;
  protected abstract handleCancelOrderError(error: unknown): void;
  protected abstract handleCreateOrderSuccess(order: OrderState): void;
  protected abstract handleCreateOrderError(error: unknown): void;
  protected abstract handleFetchOrderSuccess(order: OrderState): void;
  protected abstract handleFetchOrderError(error: unknown): void;
}
