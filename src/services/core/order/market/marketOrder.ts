import { GekkoError } from '@errors/gekko.error';
import { Action } from '@models/action.types';
import { OrderState } from '@models/order.types';
import { Exchange } from '@services/exchange/exchange';
import { InvalidOrder } from '@services/exchange/exchange.error';
import { warning } from '@services/logger';
import { Order } from '../order';
import { createOrderSummary } from '../order.utils';

export class MarketOrder extends Order {
  public readonly creation: Promise<void>;
  private readonly side: Action;

  constructor(side: Action, amount: number, exchange: Exchange) {
    super(exchange, 'MARKET');
    this.side = side;
    this.creation = this.createMarketOrder(side, amount);
  }

  public async createSummary() {
    if (!this.isOrderCompleted()) throw new GekkoError('core', 'Order is not completed');

    return createOrderSummary({
      exchange: this.exchange,
      label: 'MARKET',
      side: this.side,
      transactions: this.transactions,
    });
  }

  protected handleCreateOrderSuccess(order: OrderState) {
    this.applyOrderUpdate(order);
  }

  protected handleCreateOrderError(error: unknown) {
    if (error instanceof InvalidOrder) return Promise.resolve(this.orderRejected(error.message));
    if (error instanceof Error) this.orderErrored(error);
    throw error;
  }

  protected handleCancelOrderSuccess(order: OrderState) {
    this.applyOrderUpdate(order);
  }

  protected handleCancelOrderError(error: unknown) {
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
    const { id, timestamp, filled = 0, status } = order;
    if (!id) return;

    const transaction = { id, timestamp, filled };
    const index = this.transactions.findIndex(t => t.id === id);
    if (index >= 0) this.transactions[index] = transaction;
    else this.transactions.push(transaction);

    if (filled) this.orderPartiallyFilled(id, filled);

    if (status === 'closed') return this.orderFilled();
    if (status === 'canceled') return this.orderCanceled(filled > 0);
    if (status === 'open') return this.setStatus('open');

    warning('core', `Order update returned unexpected status: ${status ?? 'unknown'}`);
  }

  private isOrderCompleted() {
    return ['rejected', 'canceled', 'filled'].includes(this.getStatus());
  }
}
