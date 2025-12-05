import { OrderSide, OrderState } from '@models/order.types';
import { InvalidOrder } from '@services/exchange/exchange.error';
import { warning } from '@services/logger';
import { UUID } from 'node:crypto';
import { Order } from '../order';

export class MarketOrder extends Order {
  public readonly amount: number;
  private id?: string;

  constructor(gekkoOrderId: UUID, side: OrderSide, amount: number, _price?: number) {
    super(gekkoOrderId, side, 'MARKET');
    this.amount = amount;
  }

  public async launch(): Promise<void> {
    await this.createMarketOrder(this.side, this.amount);
  }

  public async cancel() {
    if (!this.id || this.isOrderCompleted()) return;
    await this.cancelOrder(this.id);
  }

  public checkOrder(): Promise<void> {
    // No need to follow order evolution for this kind of order.
    return Promise.resolve();
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
    const { id, timestamp, filled = 0, status, remaining = 0 } = order;
    if (!id) return;

    const oldTransaction = this.transactions.get(id);

    this.id = id;
    this.transactions.set(id, { id, timestamp, filled, status });

    if (filled) this.orderPartiallyFilled(id, filled);

    switch (status) {
      case 'closed':
        return this.orderFilled();
      case 'canceled':
        return this.orderCanceled({ filled, remaining, timestamp });
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
