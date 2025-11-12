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
import { Nullable } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { OrderSummary } from '@services/core/order/order.types';
import { debug, error, info, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { addMinutes } from 'date-fns';
import { bindAll, filter, isEqual } from 'lodash-es';
import { UUID } from 'node:crypto';
import { DEFAULT_FEE_BUFFER, ORDER_FACTORY, SYNCHRONIZATION_INTERVAL } from './trader.const';
import { traderSchema } from './trader.schema';
import { TraderOrderMetadata } from './trader.types';
import { computeOrderPricing, isEmptyPortfolio } from './trader.utils';

export class Trader extends Plugin {
  private readonly orders: Map<UUID, TraderOrderMetadata>;
  private warmupCompleted: boolean;
  private warmupCandle: Nullable<Candle>;
  private portfolio: Portfolio;
  private balance: number;
  private price: number;
  // Timer controlling periodic synchronization with the exchange.
  private syncInterval: Nullable<Timer>;
  private currentTimestamp: EpochTimeStamp;

  constructor() {
    super(Trader.name);
    this.orders = new Map();
    this.warmupCompleted = false;
    this.warmupCandle = null;
    this.portfolio = { asset: 0, currency: 0 };
    this.balance = 0;
    this.price = 0;
    this.currentTimestamp = 0;

    bindAll(this, [this.synchronize.name]);

    this.syncInterval = setInterval(this.synchronize, SYNCHRONIZATION_INTERVAL);
  }

  private async synchronize() {
    const exchange = this.getExchange();
    info('trader', `Synchronizing data with ${exchange.getExchangeName()}`);

    // Save old porfolio and balance
    const oldPortfolio = this.portfolio;
    const oldBalance = this.balance;

    // Update portfolio and balance
    this.portfolio = await exchange.fetchPortfolio();
    this.balance = this.price * this.portfolio.asset + this.portfolio.currency;

    debug(
      'trader',
      `Current portfolio: ${this.portfolio.asset} ${this.asset} / ${this.portfolio.currency} ${this.currency}`,
    );

    // Emit portfolio events if changes are detected
    if (this.currentTimestamp && !isEqual(oldPortfolio, this.portfolio)) this.emitPortfolioChangeEvent();
    if (this.currentTimestamp && oldBalance !== this.balance) this.emitPortfolioValueChangeEvent();
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

  public async onStrategyWarmupCompleted() {
    this.warmupCompleted = true;
    const candle = this.warmupCandle;
    this.warmupCandle = null;
    if (candle) await this.processOneMinuteCandle(candle);
    await this.synchronize();
  }

  public onStrategyCancelOrder(id: UUID) {
    const orderMetadata = this.orders.get(id);
    if (!orderMetadata) return warning('trader', 'Impossible to cancel order: Unknown Order');
    const { orderInstance, side, amount, type, price } = orderMetadata;

    orderInstance.removeAllListeners();

    // Handle Cancel Success hook
    orderInstance.once(ORDER_CANCELED_EVENT, async ({ filled = 0, remaining = Math.max(0, amount - filled) }) => {
      this.orders.delete(id);
      this.deferredEmit<OrderCanceled>(ORDER_CANCELED_EVENT, {
        orderId: id,
        date: this.currentTimestamp,
        type,
        side,
        amount,
        filled,
        remaining,
        price,
      });
      await this.synchronize();
    });

    // Handle Cancel Error hook
    orderInstance.once(ORDER_ERRORED_EVENT, async reason => {
      this.orders.delete(id);
      this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
        orderId: id,
        date: this.currentTimestamp,
        type,
        side,
        reason,
        amount,
      });
      await this.synchronize();
    });
    orderInstance.cancel();
  }

  public onStrategyCreateOrder(advice: Advice) {
    const { order, date, id } = advice;
    const { side, type, quantity, price = this.price } = order;
    const { asset, currency } = this.portfolio;

    // Price cannot be zero here because we call processOneMinuteCandle before events (plugins stream)
    // We delegate the order validation (notional, lot, amount) to the exchange
    const computedAmount = side === 'BUY' ? (currency / price) * (1 - DEFAULT_FEE_BUFFER) : asset;
    const amount = quantity ?? computedAmount;

    info('trader', `Creating ${type} order to ${side} ${amount} ${this.asset}`);
    this.deferredEmit<OrderInitiated>(ORDER_INITIATED_EVENT, {
      orderId: id,
      side,
      date,
      type,
      amount,
      price,
      balance: this.balance,
      portfolio: this.portfolio,
    });

    const exchange = this.getExchange();
    const orderInstance = new ORDER_FACTORY[type](id, side, amount, exchange, price);
    this.orders.set(id, { amount, side, type, price, orderInstance });

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
      this.orders.delete(id);
      await this.synchronize();
      this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
        orderId: id,
        type,
        side,
        date: this.currentTimestamp,
        reason,
        amount,
      });
    });

    orderInstance.on(ORDER_ERRORED_EVENT, async reason => {
      error('trader', `Gekko received error: ${reason}`);
      this.orders.delete(id);
      await this.synchronize();
      this.deferredEmit<OrderErrored>(ORDER_ERRORED_EVENT, {
        orderId: id,
        type,
        side,
        date: this.currentTimestamp,
        reason,
        amount,
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
        this.orders.delete(id);
      }
    });
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected async processOneMinuteCandle(candle: Candle) {
    // Update price first (needed in synchronize fn)
    this.price = candle.close;

    // Then synchronize with exchange only the first execution of this function
    if (this.currentTimestamp === 0 && isEmptyPortfolio(this.portfolio)) await this.synchronize();

    // Then update current timestamp
    this.currentTimestamp = addMinutes(candle.start, 1).getTime();

    // Update warmup candle until warmup is completed
    if (!this.warmupCompleted) this.warmupCandle = candle;
  }

  protected processFinalize(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  public static getStaticConfiguration() {
    return {
      name: 'Trader',
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
      // Trader is most important than other plugins. it must be executed first
      weight: 1,
    } as const;
  }
}
