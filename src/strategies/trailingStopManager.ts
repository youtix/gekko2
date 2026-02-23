import { TRAILING_STOP_ACTIVATED, TRAILING_STOP_TRIGGERED } from '@constants/event.const';
import { StrategyOrder } from '@models/advice.types';
import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { isNil } from 'lodash-es';
import { UUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { TrailingStopState } from './trailingStopManager.types';

type AddOrderParams = Pick<StrategyOrder, 'symbol' | 'side' | 'amount' | 'trailing'> & {
  id: UUID;
  createdAt: number;
};

export class TrailingStopManager extends EventEmitter {
  private orders = new Map<UUID, TrailingStopState>();

  public addOrder({ id, symbol, side, amount, trailing, createdAt }: AddOrderParams): void {
    if (!trailing) return;
    if (!isNil(amount) && amount <= 0) {
      warning('trailing stop', `Cannot create trailing stop without a valid amount, current order amount: ${amount}`);
      return;
    }
    if (trailing.percentage <= 0 || trailing.percentage >= 100) {
      warning('trailing stop', `Invalid trailing percentage: ${trailing.percentage}%. Must be between 0 and 100 exclusive.`);
      return;
    }
    if (trailing.trigger && trailing.trigger <= 0) {
      warning('trailing stop', `Invalid trigger price: ${trailing.trigger}. Must be positive.`);
      return;
    }

    const activationPrice = trailing.trigger;
    const isDirectlyActive = isNil(activationPrice);

    this.orders.set(id, {
      id,
      symbol,
      side,
      amount,
      config: trailing,
      status: isDirectlyActive ? 'active' : 'dormant',
      highestPeak: 0,
      stopPrice: 0,
      activationPrice,
      createdAt,
    });
  }

  public update(bucket: CandleBucket): void {
    for (const [id, order] of this.orders) {
      const candle = bucket.get(order.symbol);
      if (!candle) continue;

      if (order.status === 'dormant') this.processDormant(order, candle.high);
      if (order.status === 'active') this.processActive(id, order, candle.high, candle.low);
    }
  }

  public removeOrder(id: UUID): boolean {
    return this.orders.delete(id);
  }

  public getOrders(): ReadonlyMap<UUID, TrailingStopState> {
    return this.orders;
  }

  private processDormant(order: TrailingStopState, high: number): void {
    if (!isNil(order.activationPrice) && high < order.activationPrice) return;

    order.status = 'active';
    order.highestPeak = high;
    order.stopPrice = high * (1 - order.config.percentage / 100);

    this.emit<TrailingStopState>(TRAILING_STOP_ACTIVATED, { ...order });
  }

  private processActive(id: UUID, order: TrailingStopState, high: number, low: number): void {
    order.highestPeak = Math.max(order.highestPeak, high);
    order.stopPrice = order.highestPeak * (1 - order.config.percentage / 100);

    if (low <= order.stopPrice) {
      this.emit<TrailingStopState>(TRAILING_STOP_TRIGGERED, { ...order });
      this.orders.delete(id);
      return;
    }
  }
}
