import { TRAILING_STOP_ACTIVATED, TRAILING_STOP_TRIGGERED } from '@constants/event.const';
import { StrategyOrder } from '@models/advice.types';
import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { isNil } from 'lodash-es';
import { UUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { TrailingStopState } from './trailingStopManager.types';

type AddOrderParams = Pick<StrategyOrder, 'symbol' | 'trailing'> & {
  id: UUID;
  /** The amount the BUY filled (see TrailingStopState.amount) */
  amount: number;
  createdAt: number;
};

export class TrailingStopManager extends EventEmitter {
  private orders = new Map<UUID, TrailingStopState>();

  public addOrder({ id, symbol, amount, trailing, createdAt }: AddOrderParams): void {
    if (!trailing) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      warning('trailing stop', `Cannot create trailing stop without a valid amount, current order amount: ${amount}`);
      return;
    }
    // Checked for what it must be rather than against what it must not be: NaN, or a percentage left undefined (a strategy parameter
    // misspelt), failed both comparisons and passed, arming a stop whose price was NaN, which never triggered.
    if (!(trailing.percentage > 0 && trailing.percentage < 100)) {
      warning('trailing stop', `Invalid trailing percentage: ${trailing.percentage}%. Must be between 0 and 100 exclusive.`);
      return;
    }
    // Leaving the trigger out asks for a stop active at once. A trigger given must be a price: 0 and NaN, falsy, passed as if left
    // out, and Infinity armed a stop that never activated.
    if (!isNil(trailing.trigger) && !(Number.isFinite(trailing.trigger) && trailing.trigger > 0)) {
      warning('trailing stop', `Invalid trigger price: ${trailing.trigger}. Must be positive.`);
      return;
    }

    const activationPrice = trailing.trigger;
    const isDirectlyActive = isNil(activationPrice);
    const order: TrailingStopState = {
      id,
      symbol,
      amount,
      config: trailing,
      status: isDirectlyActive ? 'active' : 'dormant',
      highestPeak: 0,
      stopPrice: 0,
      activationPrice,
      createdAt,
    };
    this.orders.set(id, order);

    // Without a trigger the stop is active as soon as it is armed: its activation is announced now, as a stop with a trigger has its
    // own when the price reaches it (see processDormant), else the strategy never hears of it. It trails from the next candle on: its
    // peak and stop price are still 0.
    if (isDirectlyActive) this.emit<TrailingStopState>(TRAILING_STOP_ACTIVATED, { ...order });
  }

  public update(bucket: CandleBucket): void {
    for (const [id, order] of this.orders) {
      const candle = bucket.get(order.symbol);
      if (!candle) continue;

      if (order.status === 'dormant') this.processDormant(order, candle.high);
      // The strategy hears of the activation at once, and may cancel the stop then (tools.cancelTrailingOrder): a stop no longer
      // listed is over, and must not trail the candle that activated it, nor send the SELL of a stop the strategy has just canceled.
      if (order.status === 'active' && this.orders.has(id)) this.processActive(id, order, candle.high, candle.low);
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
