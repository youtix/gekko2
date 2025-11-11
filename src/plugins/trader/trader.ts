import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INITIATED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { Advice } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { OrderCanceled, OrderCompleted, OrderErrored, OrderInitiated, OrderType } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Plugin } from '@plugins/plugin';
import { Order } from '@services/core/order/order';
import { OrderSummary } from '@services/core/order/order.types';
import { debug, error, info, warning } from '@services/logger';
import { toISOString, toTimestamp } from '@utils/date/date.utils';
import { wait } from '@utils/process/process.utils';
import { addMinutes } from 'date-fns';
import { bindAll, filter, isEqual } from 'lodash-es';
import { UUID } from 'node:crypto';
import { DEFAULT_FEE_BUFFER, ORDER_FACTORY, SYNCHRONIZATION_INTERVAL } from './trader.const';
import { traderSchema } from './trader.schema';
import { computeOrderPricing } from './trader.utils';

export class Trader extends Plugin {
  private readonly orders: Order[];
  private sendInitialPortfolio: boolean;
  private warmupCompleted: boolean;
  private warmupCandle?: Candle;
  private portfolio: Portfolio;
  private balance: number;
  private price: number;
  // Timer controlling periodic synchronization with the exchange.
  private syncInterval?: Timer;
  private currentTimestamp: EpochTimeStamp;

  constructor() {
    super(Trader.name);
    this.orders = [];
    this.sendInitialPortfolio = false;
    this.warmupCompleted = false;
    this.warmupCandle = undefined;
    this.portfolio = { asset: 0, currency: 0 };
    this.balance = 0;
    this.price = 0;
    // Let's use the start date when using backtest mode
    this.currentTimestamp = this.daterange ? toTimestamp(this.daterange?.start) : Date.now();

    bindAll(this, [this.synchronize.name]);

    this.syncInterval = setInterval(this.synchronize, SYNCHRONIZATION_INTERVAL);
  }

  private async synchronize() {
    const exchange = this.getExchange();
    info('trader', `Synchronizing data with ${exchange.getExchangeName()}`);
    if (!this.price) {
      const sleepInterval = exchange.getInterval();
      const ticker = await exchange.fetchTicker();
      this.price = ticker.bid;
      await wait(sleepInterval);
    }
    const oldPortfolio = this.portfolio;
    this.portfolio = await exchange.fetchPortfolio();
    debug(
      'trader',
      `Current portfolio: ${this.portfolio.asset} ${this.asset} / ${this.portfolio.currency} ${this.currency}`,
    );

    this.updateBalance();
    if (this.sendInitialPortfolio && !isEqual(oldPortfolio, this.portfolio)) this.emitPortfolioChangeEvent();
  }

  private emitPortfolioChangeEvent() {
    this.deferredEmit(PORTFOLIO_CHANGE_EVENT, {
      asset: this.portfolio.asset,
      currency: this.portfolio.currency,
    });
  }

  private emitPortfolioValueChangeEvent() {
    this.deferredEmit(PORTFOLIO_VALUE_CHANGE_EVENT, {
      balance: this.balance,
    });
  }

  private emitOrderCompletedEvent(id: UUID, type: OrderType, summary: OrderSummary) {
    const { amount, price, feePercent, side, date } = summary;
    const { effectivePrice, fee } = computeOrderPricing(side, price, amount, feePercent);

    info(
      'trader',
      [
        `${side} ${type} order summary '${id}':`,
        `Completed at: ${toISOString(date)}`,
        `Order amount: ${amount},`,
        `Effective price: ${effectivePrice},`,
        `Fee: ${fee},`,
        `Fee percent: ${feePercent},`,
      ].join(' '),
    );

    if (!date) throw new GekkoError('trader', 'Inconsistent state: No timestamp returned from order creation');

    this.deferredEmit<OrderCompleted>(ORDER_COMPLETED_EVENT, {
      orderId: id,
      side,
      fee,
      amount,
      price,
      portfolio: this.portfolio,
      balance: this.balance,
      date,
      feePercent: feePercent,
      effectivePrice,
      type,
    });
  }

  private updateBalance() {
    this.balance = this.price * this.portfolio.asset + this.portfolio.currency;
  }

  public onStrategyWarmupCompleted() {
    this.warmupCompleted = true;
    const candle = this.warmupCandle;
    this.warmupCandle = undefined;
    if (!candle) throw new GekkoError('trader', 'No warmup candle on strategy warmup completed event');
    void this.processOneMinuteCandle(candle);
  }

  public onStrategyCancelOrder(id: UUID) {
    const orderInstance = this.getOrder(id);
    if (!orderInstance) return warning('trader', 'Impossible to cancel order: Unknown Order');

    const type = orderInstance.getType();
    orderInstance.removeAllListeners();

    // Handle Cancel Success hook
    orderInstance.once(ORDER_CANCELED_EVENT, async () => {
      this.removeOrder(id);
      this.deferredEmit<OrderCanceled>(ORDER_CANCELED_EVENT, {
        orderId: id,
        date: this.currentTimestamp,
        type,
      });
      await this.synchronize();
    });

    // Handle Cancel Error hook
    orderInstance.once(ORDER_ERRORED_EVENT, async reason => {
      this.removeOrder(id);
      this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
        orderId: id,
        date: this.currentTimestamp,
        type,
        reason,
      });
      await this.synchronize();
    });
    orderInstance.cancel();
  }

  public onStrategyCreateOrder(advice: Advice) {
    const { order, date, id } = advice;
    const { side, type, quantity } = order;
    const { asset, currency } = this.portfolio;

    if (!quantity && side === 'BUY' && !this.price) {
      const reason = 'Impossible to create order because the trading strategy is warming up';
      error('trader', reason);
      this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
        orderId: id,
        type,
        date: this.currentTimestamp,
        reason,
      });
    }

    // We delegate the order validation (notional, lot, amount) to the exchange
    const amount = quantity ?? (side === 'BUY' ? (currency / this.price) * (1 - DEFAULT_FEE_BUFFER) : asset);

    info('trader', `Creating ${type} order to ${side} ${amount} ${this.asset}`);
    this.deferredEmit<OrderInitiated>(ORDER_INITIATED_EVENT, {
      orderId: id,
      side: side,
      portfolio: this.portfolio,
      balance: this.balance,
      date,
      type,
      amount: amount,
    });

    const exchange = this.getExchange();
    const orderInstance = new ORDER_FACTORY[type](id, side, amount, exchange);
    this.orders.push(orderInstance);

    // UPDATE EVENTS
    orderInstance.on(ORDER_PARTIALLY_FILLED_EVENT, filled =>
      info('trader', `Partial ${side} order fill, total filled: ${filled}`),
    );
    orderInstance.on(ORDER_STATUS_CHANGED_EVENT, ({ status, reason }) =>
      info('trader', `status changed: ${status}, reason: ${reason}`),
    );

    // ERROR EVENTS
    orderInstance.on(ORDER_INVALID_EVENT, async ({ reason }) => {
      info('trader', `Order rejected : ${reason}`);
      this.removeOrder(id);
      await this.synchronize();
      this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
        orderId: id,
        type,
        date: this.currentTimestamp,
        reason,
      });
    });

    orderInstance.on(ORDER_ERRORED_EVENT, async reason => {
      error('trader', `Gekko received error: ${reason}`);
      this.removeOrder(id);
      await this.synchronize();
      this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
        orderId: id,
        type,
        date: this.currentTimestamp,
        reason,
      });
    });

    // SUCCES EVENTS
    orderInstance.on(ORDER_COMPLETED_EVENT, async () => {
      try {
        const summary = await orderInstance.createSummary();
        await this.synchronize();
        this.emitOrderCompletedEvent(id, order.type, summary);
      } catch (err) {
        error('trader', err instanceof Error ? err.message : 'Unknown error on order completed');
      } finally {
        this.removeOrder(id);
      }
    });
  }

  private removeOrder(id: UUID) {
    const index = this.orders.findIndex(o => o.getGekkoOrderId() === id);
    if (index >= 0) this.orders.splice(index, 1);
  }

  private getOrder(id: UUID) {
    const orderIndex = this.orders.findIndex(o => o.getGekkoOrderId() === id);
    if (orderIndex === -1) return;
    return this.orders[orderIndex];
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected async processOneMinuteCandle(candle: Candle) {
    this.currentTimestamp = addMinutes(candle.start, 1).getTime();

    if (!this.warmupCompleted) {
      this.warmupCandle = candle;
      return;
    }

    this.price = candle.close;
    const previousBalance = this.balance;
    this.updateBalance();

    if (!this.sendInitialPortfolio) {
      this.sendInitialPortfolio = true;
      await this.synchronize();
    }

    if (this.balance !== previousBalance) {
      // this can happen because:
      // A) the price moved and we have > 0 asset
      // B) portfolio got changed
      this.emitPortfolioValueChangeEvent();
    }
  }

  protected processFinalize(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
  }

  public static getStaticConfiguration() {
    return {
      schema: traderSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: ['exchange'],
      eventsHandlers: filter(Object.getOwnPropertyNames(Trader.prototype), p => p.startsWith('on')),
      eventsEmitted: [
        PORTFOLIO_CHANGE_EVENT,
        PORTFOLIO_VALUE_CHANGE_EVENT,
        ORDER_CANCELED_EVENT,
        ORDER_COMPLETED_EVENT,
        ORDER_ERRORED_EVENT,
        ORDER_INITIATED_EVENT,
      ],
      name: 'Trader',
    };
  }
}
