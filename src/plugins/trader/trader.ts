import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INITIATED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
  PORTFOLIO_CHANGE_EVENT,
} from '@constants/event.const';
import { DEFAULT_FEE_BUFFER } from '@constants/order.const';
import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { GekkoError } from '@errors/gekko.error';
import { AdviceOrder } from '@models/advice.types';
import { CandleBucket, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { OrderSummary } from '@services/core/order/order.types';
import { error, info, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { createEmptyPortfolio, getAssetBalance } from '@utils/portfolio/portfolio.utils';
import { addMinutes, differenceInMinutes } from 'date-fns';
import { bindAll, cloneDeep, filter } from 'lodash-es';
import { UUID } from 'node:crypto';
import { ORDER_FACTORY } from './trader.const';
import { traderSchema } from './trader.schema';
import { TraderOrderMetadata } from './trader.types';
import { computeOrderPricing, PortfolioUpdatesConfig, shouldEmitPortfolio, ShouldEmitPortfolioParams } from './trader.utils';

export class Trader extends Plugin {
  private readonly orders: Map<UUID, TraderOrderMetadata>;
  private warmupCompleted: boolean;
  private warmupBucket: CandleBucket;
  private portfolio: Portfolio;
  private prices: Map<TradingPair, number>;
  private currentTimestamp: EpochTimeStamp;
  private syncInterval: NodeJS.Timeout | null;
  private lastEmittedPortfolio: Portfolio | null;
  private readonly portfolioUpdatesConfig: PortfolioUpdatesConfig | null;

  constructor(parameters?: { portfolioUpdates?: PortfolioUpdatesConfig }) {
    super(Trader.name);
    this.orders = new Map();
    this.warmupCompleted = false;
    this.warmupBucket = new Map();
    this.portfolio = createEmptyPortfolio();
    this.prices = new Map();
    this.currentTimestamp = 0;
    this.syncInterval = null;
    this.lastEmittedPortfolio = null;
    this.portfolioUpdatesConfig = parameters?.portfolioUpdates ?? null;

    bindAll(this, [this.synchronize.name]);
  }

  private async synchronize() {
    const exchange = this.getExchange();
    info('trader', `Synchronizing data with ${exchange.getExchangeName()}`);

    // Update portfolio, balance and prices
    this.portfolio = await exchange.fetchBalance();
    const tickers = await exchange.fetchTickers(this.pairs);
    for (const symbol of this.pairs) {
      const price = tickers[symbol].bid;
      this.prices.set(symbol, price);
    }

    // Emit portfolio events if changes are detected
    if (this.portfolioUpdatesConfig) {
      const params: ShouldEmitPortfolioParams = {
        current: this.portfolio,
        lastEmitted: this.lastEmittedPortfolio,
        prices: this.prices,
        pairs: this.pairs,
        portfolioConfig: this.portfolioUpdatesConfig,
      };
      if (shouldEmitPortfolio(params)) {
        this.emitPortfolioChangeEvent();
        this.lastEmittedPortfolio = cloneDeep(this.portfolio);
      }
    } else {
      this.emitPortfolioChangeEvent();
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                             EVENT EMITERS                                  */
  /* -------------------------------------------------------------------------- */

  private emitPortfolioChangeEvent() {
    this.addDeferredEmit<Portfolio>(PORTFOLIO_CHANGE_EVENT, this.portfolio);
  }

  private emitOrderCompletedEvent(id: UUID, summary: OrderSummary) {
    const orderMetadata = this.orders.get(id);
    if (!orderMetadata) throw new GekkoError('trader', `[${id}] No order metadata found in order completed event`);

    const { amount, price, feePercent, side, orderExecutionDate } = summary;
    const { effectivePrice, fee } = computeOrderPricing(side, price, amount, feePercent);
    const { orderCreationDate, type, symbol } = orderMetadata;

    info(
      'trader',
      [
        `[${id}] ${side} ${type} order summary for ${symbol}:`,
        `Completed at: ${toISOString(orderExecutionDate)}`,
        `Order amount: ${amount},`,
        `Effective price: ${effectivePrice},`,
        `Fee: ${fee},`,
        `Fee percent: ${feePercent},`,
      ].join(' '),
    );

    const currentPrice = this.prices.get(symbol) ?? 0;
    const order = { ...summary, id, orderCreationDate, type, fee, effectivePrice, symbol };
    const exchange = { price: currentPrice, portfolio: this.portfolio };
    this.addDeferredEmit<OrderCompletedEvent>(ORDER_COMPLETED_EVENT, { order, exchange });
  }

  /* -------------------------------------------------------------------------- */
  /*                             EVENT LISTENERS                                */
  /* -------------------------------------------------------------------------- */

  public async onStrategyWarmupCompleted(_bucket: CandleBucket[]) {
    // There is only one warmup event during the execution
    this.warmupCompleted = true;
    const oneMinuteCandleBucket = this.warmupBucket;
    this.warmupBucket = new Map();

    if (oneMinuteCandleBucket.size === this.pairs.length) await this.processOneMinuteBucket(oneMinuteCandleBucket);
    else throw new GekkoError('trader', 'Impossible to process warmup bucket: Not all pairs are present');

    await this.synchronize();
  }

  public async onStrategyCancelOrder(payloads: UUID[]) {
    // Parallel strategy: process all payloads concurrently
    await Promise.all(
      payloads.map(async id => {
        const orderMetadata = this.orders.get(id);
        if (!orderMetadata) return warning('trader', `[${id}] Impossible to cancel order: Unknown Order`);
        const { orderInstance, side, amount, type, orderCreationDate, price, symbol } = orderMetadata;

        orderInstance.removeAllListeners();

        // Handle Cancel Success hook
        orderInstance.once(ORDER_CANCELED_EVENT, async ({ timestamp: orderCancelationDate, filled, remaining }) => {
          this.orders.delete(id);
          await this.synchronize();
          const order = { id, orderCreationDate, orderCancelationDate, amount, side, type, price, filled, remaining, symbol };
          const exchange = { price: this.prices.get(symbol) ?? 0, portfolio: this.portfolio };
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
              err instanceof Error ? `[${id}] Error in order completed ${err.message}` : `[${id}] Unknown error on order completed`,
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
            symbol,
          };
          const exchange = { price: this.prices.get(symbol) || 0, portfolio: this.portfolio };
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
        const { id, side, orderCreationDate, type, symbol } = advice;
        const price = advice.price ?? this.prices.get(symbol);
        if (!price || price <= 0) {
          warning('trader', `[${id}] No price found for symbol: ${symbol}`);
          return; // Reject order
        }

        const [assetName, currencyName] = symbol.split('/');
        const asset = getAssetBalance(this.portfolio, assetName);
        const currency = getAssetBalance(this.portfolio, currencyName);

        // Price cannot be zero here because we call processOneMinuteBucket before events (plugins stream)
        // We delegate the order validation (notional, lot, amount) to the exchange
        const computedAmount = side === 'BUY' ? (currency.free / price) * (1 - DEFAULT_FEE_BUFFER) : asset.free;
        const amount = advice.amount ?? computedAmount;

        // Emit order initiated event
        const orderInitiated = { ...advice, amount, symbol };
        const exchange = { price: this.prices.get(symbol) || 0, portfolio: this.portfolio };
        this.addDeferredEmit<OrderInitiatedEvent>(ORDER_INITIATED_EVENT, { order: orderInitiated, exchange });

        // Create order
        const orderInstance = new ORDER_FACTORY[type](symbol, id, side, amount, price);
        this.orders.set(id, { amount, side, orderCreationDate, type, price, orderInstance, symbol });

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
          const exchange = { price: this.prices.get(symbol) || 0, portfolio: this.portfolio };
          this.addDeferredEmit<OrderErroredEvent>(ORDER_ERRORED_EVENT, { order, exchange });
        });

        orderInstance.on(ORDER_ERRORED_EVENT, async reason => {
          error('trader', `[${id}] ${side} ${type} order: ${reason} (status: ERROR)`);
          this.orders.delete(id);
          await this.synchronize();
          const order = { ...orderInitiated, reason, orderErrorDate: this.currentTimestamp };
          const exchange = { price: this.prices.get(symbol) || 0, portfolio: this.portfolio };
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
              err instanceof Error ? `[${id}] Error in order completed ${err.message}` : `[${id}] Unknown error on order completed`,
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

  protected async processOneMinuteBucket(bucket: CandleBucket) {
    // Get first candle for timestamp
    const firstEntry = bucket.values().next().value;
    if (!firstEntry) throw new GekkoError('trader', 'Impossible to process one minute bucket: Empty candle bucket');

    // Update warmup candle bucket until warmup is completed
    if (!this.warmupCompleted) this.warmupBucket = bucket;

    // Update all candle bucket prices
    for (const [symbol, candle] of bucket) this.prices.set(symbol, candle.close);

    // Synchronize periodically in backtest mode (order fills are handled by exchange callbacks)
    if (this.mode === 'backtest') {
      const minutes = differenceInMinutes(firstEntry.start, 0);
      if (this.currentTimestamp && minutes % TIMEFRAME_TO_MINUTES[this.timeframe ?? '1m'] === 0) await this.synchronize();
    }

    // Then update current timestamp
    this.currentTimestamp = addMinutes(firstEntry.start, 1).getTime();
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
      eventsEmitted: [PORTFOLIO_CHANGE_EVENT, ORDER_CANCELED_EVENT, ORDER_COMPLETED_EVENT, ORDER_ERRORED_EVENT, ORDER_INITIATED_EVENT],
    } as const;
  }
}
