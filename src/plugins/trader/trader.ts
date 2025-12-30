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
import { DEFAULT_FEE_BUFFER } from '@constants/order.const';
import { GekkoError } from '@errors/gekko.error';
import { AdviceOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import {
  BalanceSnapshot,
  OrderCanceledEvent,
  OrderCompletedEvent,
  OrderErroredEvent,
  OrderInitiatedEvent,
} from '@models/event.types';
import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { Nullable } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { OrderSummary } from '@services/core/order/order.types';
import { debug, error, info, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { addMinutes, differenceInMinutes } from 'date-fns';
import { bindAll, filter, isEqual } from 'lodash-es';
import { UUID } from 'node:crypto';
import { BACKTEST_SYNC_INTERVAL, ORDER_FACTORY } from './trader.const';
import { traderSchema } from './trader.schema';
import { TraderOrderMetadata } from './trader.types';
import { computeOrderPricing } from './trader.utils';

export class Trader extends Plugin {
  private readonly orders: Map<UUID, TraderOrderMetadata>;
  private warmupCompleted: boolean;
  private warmupCandle: Nullable<Candle>;
  private portfolio: Portfolio;
  private balance: BalanceDetail;
  private price: number;
  private currentTimestamp: EpochTimeStamp;
  private syncInterval: NodeJS.Timeout | null;

  constructor() {
    super(Trader.name);
    this.orders = new Map();
    this.warmupCompleted = false;
    this.warmupCandle = null;
    this.portfolio = {
      asset: { free: 0, used: 0, total: 0 },
      currency: { free: 0, used: 0, total: 0 },
    };
    this.balance = { free: 0, used: 0, total: 0 };
    this.price = 0;
    this.currentTimestamp = 0;
    this.syncInterval = null;

    bindAll(this, [this.synchronize.name]);
  }

  private async synchronize() {
    const exchange = this.getExchange();
    info('trader', `Synchronizing data with ${exchange.getExchangeName()}`);

    // Save old porfolio and balance
    const oldPortfolio = this.portfolio;
    const oldBalance = this.balance;

    // Update portfolio, balance and price
    const { bid } = await exchange.fetchTicker();
    this.portfolio = await exchange.fetchBalance();
    this.price = bid;
    this.balance = {
      free: this.price * this.portfolio.asset.free + this.portfolio.currency.free,
      used: this.price * this.portfolio.asset.used + this.portfolio.currency.used,
      total: this.price * this.portfolio.asset.total + this.portfolio.currency.total,
    };

    debug(
      'trader',
      `Current portfolio: ${this.portfolio.asset.total} ${this.asset} / ${this.portfolio.currency.total} ${this.currency}`,
    );

    // Emit portfolio events if changes are detected
    if (!isEqual(oldPortfolio, this.portfolio)) this.emitPortfolioChangeEvent();
    if (!isEqual(oldBalance, this.balance)) this.emitPortfolioValueChangeEvent();
  }

  /* -------------------------------------------------------------------------- */
  /*                             EVENT EMITERS                                  */
  /* -------------------------------------------------------------------------- */

  private emitPortfolioChangeEvent() {
    this.addDeferredEmit<Portfolio>(PORTFOLIO_CHANGE_EVENT, {
      asset: { ...this.portfolio.asset },
      currency: { ...this.portfolio.currency },
    });
  }

  private emitPortfolioValueChangeEvent() {
    this.addDeferredEmit<BalanceSnapshot>(PORTFOLIO_VALUE_CHANGE_EVENT, {
      balance: { ...this.balance },
      date: this.currentTimestamp,
    });
  }

  private emitOrderCompletedEvent(id: UUID, summary: OrderSummary) {
    const orderMetadata = this.orders.get(id);
    if (!orderMetadata) throw new GekkoError('trader', `[${id}] No order metadata found in order completed event`);

    const { amount, price, feePercent, side, orderExecutionDate } = summary;
    const { effectivePrice, fee } = computeOrderPricing(side, price, amount, feePercent);
    const { orderCreationDate, type } = orderMetadata;

    info(
      'trader',
      [
        `[${id}] ${side} ${type} order summary:`,
        `Completed at: ${toISOString(orderExecutionDate)}`,
        `Order amount: ${amount},`,
        `Effective price: ${effectivePrice},`,
        `Fee: ${fee},`,
        `Fee percent: ${feePercent},`,
      ].join(' '),
    );

    const order = { ...summary, id, orderCreationDate, type, fee, effectivePrice };
    const exchange = { price: this.price, portfolio: this.portfolio, balance: this.balance };
    this.addDeferredEmit<OrderCompletedEvent>(ORDER_COMPLETED_EVENT, { order, exchange });
  }

  /* -------------------------------------------------------------------------- */
  /*                             EVENT LISTENERS                                */
  /* -------------------------------------------------------------------------- */

  public async onStrategyWarmupCompleted() {
    // There is only one warmup event during the execution
    this.warmupCompleted = true;
    const candle = this.warmupCandle;
    this.warmupCandle = null;
    if (candle) await this.processOneMinuteCandle(candle);
    await this.synchronize();
  }

  public async onStrategyCancelOrder(payloads: UUID[]) {
    // Parallel strategy: process all payloads concurrently
    await Promise.all(
      payloads.map(async id => {
        const orderMetadata = this.orders.get(id);
        if (!orderMetadata) return warning('trader', `[${id}] Impossible to cancel order: Unknown Order`);
        const { orderInstance, side, amount, type, orderCreationDate, price } = orderMetadata;

        orderInstance.removeAllListeners();

        // Handle Cancel Success hook
        orderInstance.once(ORDER_CANCELED_EVENT, async ({ timestamp: orderCancelationDate, filled, remaining }) => {
          this.orders.delete(id);
          await this.synchronize();
          const order = { id, orderCreationDate, orderCancelationDate, amount, side, type, price, filled, remaining };
          const exchange = { price: this.price, portfolio: this.portfolio, balance: this.balance };
          this.addDeferredEmit<OrderCanceledEvent>(ORDER_CANCELED_EVENT, { order, exchange });
        });

        // Handle Order success event (maybe it completed before we succeed to cancel)
        orderInstance.once(ORDER_COMPLETED_EVENT, async () => {
          try {
            const summary = await orderInstance.createSummary();
            await this.synchronize();
            this.emitOrderCompletedEvent(id, summary);
          } catch (err) {
            error(
              'trader',
              err instanceof Error
                ? `[${id}] Error in order completed ${err.message}`
                : `[${id}] Unknown error on order completed`,
            );
          } finally {
            this.orders.delete(id);
          }
        });

        // Handle Cancel Error hook
        orderInstance.once(ORDER_ERRORED_EVENT, async reason => {
          this.orders.delete(id);
          await this.synchronize();
          const order = {
            id,
            orderCreationDate,
            amount,
            side,
            type,
            price,
            reason,
            orderErrorDate: this.currentTimestamp,
          };
          const exchange = { price: this.price, portfolio: this.portfolio, balance: this.balance };
          this.addDeferredEmit<OrderErroredEvent>(ORDER_ERRORED_EVENT, { order, exchange });
        });

        // Cancel
        orderInstance.cancel();
      }),
    );
  }

  public async onStrategyCreateOrder(payloads: AdviceOrder[]) {
    // Parallel strategy: process all payloads concurrently
    await Promise.all(
      payloads.map(async advice => {
        const { id, side, orderCreationDate, type, price = this.price } = advice;
        const { asset, currency } = this.portfolio;

        // Price cannot be zero here because we call processOneMinuteCandle before events (plugins stream)
        // We delegate the order validation (notional, lot, amount) to the exchange
        const computedAmount = side === 'BUY' ? (currency.free / price) * (1 - DEFAULT_FEE_BUFFER) : asset.free;
        const amount = advice.amount ?? computedAmount;

        // Emit order initiated event
        const orderInitiated = { ...advice, amount };
        const exchange = { price: this.price, portfolio: this.portfolio, balance: this.balance };
        this.addDeferredEmit<OrderInitiatedEvent>(ORDER_INITIATED_EVENT, { order: orderInitiated, exchange });

        // Create order
        const orderInstance = new ORDER_FACTORY[type](id, side, amount, price);
        this.orders.set(id, { amount, side, orderCreationDate, type, price, orderInstance });

        // UPDATE EVENTS
        orderInstance.on(ORDER_PARTIALLY_FILLED_EVENT, filled =>
          info('trader', `[${id}] ${side} ${type} order fill, total filled: ${filled}`),
        );

        orderInstance.on(ORDER_STATUS_CHANGED_EVENT, ({ status, reason }) => {
          const secondPart = `, reason: ${reason}`;
          return info('trader', `[${id}] Status changed: ${status.toUpperCase()}${reason ? secondPart : ''}`);
        });

        // ERROR EVENTS
        orderInstance.on(ORDER_INVALID_EVENT, async ({ reason, status, filled }) => {
          info('trader', `[${id}] ${side} ${type} order: ${reason} (filled: ${filled}, status: ${status})`);
          this.orders.delete(id);
          await this.synchronize();
          const order = { ...orderInitiated, reason, orderErrorDate: this.currentTimestamp };
          const exchange = { price: this.price, portfolio: this.portfolio, balance: this.balance };
          this.addDeferredEmit<OrderErroredEvent>(ORDER_ERRORED_EVENT, { order, exchange });
        });

        orderInstance.on(ORDER_ERRORED_EVENT, async reason => {
          error('trader', `[${id}] ${side} ${type} order: ${reason} (status: ERROR)`);
          this.orders.delete(id);
          await this.synchronize();
          const order = { ...orderInitiated, reason, orderErrorDate: this.currentTimestamp };
          const exchange = { price: this.price, portfolio: this.portfolio, balance: this.balance };
          this.addDeferredEmit<OrderErroredEvent>(ORDER_ERRORED_EVENT, { order, exchange });
        });

        // SUCCES EVENTS
        orderInstance.on(ORDER_COMPLETED_EVENT, async () => {
          try {
            const summary = await orderInstance.createSummary();
            await this.synchronize();
            this.emitOrderCompletedEvent(id, summary);
          } catch (err) {
            error(
              'trader',
              err instanceof Error
                ? `[${id}] Error in order completed ${err.message}`
                : `[${id}] Unknown error on order completed`,
            );
          } finally {
            this.orders.delete(id);
          }
        });

        // Launch the order
        orderInstance.launch();
      }),
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                           PLUGIN LIFECYCLE HOOKS                           */
  /* -------------------------------------------------------------------------- */

  protected processInit(): void {
    if (this.mode === 'realtime') {
      const exchangeSync = config.getExchange().exchangeSynchInterval;
      this.syncInterval = setInterval(this.synchronize, exchangeSync);
    }
    this.synchronize();
  }

  protected async processOneMinuteCandle(candle: Candle) {
    // Update price
    this.price = candle.close;

    // Update warmup candle until warmup is completed
    if (!this.warmupCompleted) this.warmupCandle = candle;

    // Check orders in backtest mode
    if (this.mode === 'backtest') {
      const minutes = differenceInMinutes(candle.start, 0);
      const promises = Array.from(this.orders.values()).map(({ orderInstance }) => orderInstance.checkOrder());
      if (this.currentTimestamp && minutes % BACKTEST_SYNC_INTERVAL === 0) promises.push(this.synchronize());
      await Promise.all(promises);
    }

    // Then update current timestamp
    this.currentTimestamp = addMinutes(candle.start, 1).getTime();
  }

  protected processFinalize(): void {
    if (this.syncInterval) clearInterval(this.syncInterval);
  }

  /* -------------------------------------------------------------------------- */
  /*                           PLUGIN CONFIGURATION                             */
  /* -------------------------------------------------------------------------- */

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
    } as const;
  }
}
