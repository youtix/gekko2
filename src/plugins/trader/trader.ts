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
import { GekkoError } from '@errors/gekko.error';
import { AdviceOrder } from '@models/advice.types';
import { CandleBucket, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { debug, error, info, warning } from '@services/logger';
import { getFirstCandleFromBucket } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { clonePortfolio, createEmptyPortfolio, getAssetBalance } from '@utils/portfolio/portfolio.utils';
import { addMinutes, differenceInMinutes } from 'date-fns';
import { filter, isNil, noop, uniq } from 'lodash-es';
import { UUID } from 'node:crypto';
import { ORDER_FACTORY } from './trader.const';
import { traderSchema } from './trader.schema';
import { CheckOrderSummaryParams, TraderOrderMetadata } from './trader.types';
import {
  computeOrderPricing,
  getBacktestModeIntervalSyncTime,
  PortfolioUpdatesConfig,
  shouldEmitPortfolio,
  ShouldEmitPortfolioParams,
} from './trader.utils';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

type OrderInstance = TraderOrderMetadata['orderInstance'];
/** An order, as the events relayed to the strategy describe it */
type RelayedOrder = OrderInitiatedEvent['order'];
/** What an order reports with ORDER_INVALID_EVENT (see Order.orderRejected) */
type OrderRejection = { reason: string; status: string; filled: boolean };
/** What an order reports with ORDER_CANCELED_EVENT (see Order.orderCanceled): relayed as is */
type OrderCancelation = { timestamp: EpochTimeStamp } & Pick<OrderCanceledEvent['order'], 'filled' | 'remaining'>;

export class Trader extends Plugin {
  private readonly orders: Map<UUID, TraderOrderMetadata>;
  private readonly portfolioUpdatesConfig: PortfolioUpdatesConfig | null;

  private warmupCompleted: boolean = false;
  private warmupBucket: CandleBucket = new Map();
  private portfolio: Portfolio = createEmptyPortfolio();
  private prices: Map<TradingPair, number> = new Map();
  private currentTimestamp: EpochTimeStamp = 0;
  private syncInterval: NodeJS.Timeout | null = null;
  private lastEmittedPortfolio: Portfolio | null = null;
  /** The synchronization in flight, if any (see synchronize) */
  private synchronization: Promise<void> | null = null;
  /** How many synchronizations have started: whoever notes the count knows which ones read the exchange after that moment */
  private synchronizationCount = 0;

  constructor(parameters?: { portfolioUpdates?: PortfolioUpdatesConfig }) {
    super(Trader.name);
    this.orders = new Map();
    this.portfolioUpdatesConfig = parameters?.portfolioUpdates ?? null;
  }

  /* -------------------------------------------------------------------------- */
  /*                              SYNCHRONIZATION                               */
  /* -------------------------------------------------------------------------- */

  /**
   * Reads the portfolio and the prices from the exchange again, and emits the portfolio. One synchronization at a time: two in
   * flight could end in any order, the older one overwriting what the newer one read, and each would emit the portfolio. A call made
   * while one is in flight joins it, and shares its outcome.
   *
   * Unless it started too early for the caller. An order that ended filled or canceled changed the portfolio (a fill, the release of
   * what the order reserved), and its event carries the portfolio after that change: `startedAfter` is then the count of
   * synchronizations started when the order ended, and one started before may have read the exchange too early. The caller waits
   * for it to end, then joins the next one, which all such callers share.
   *
   * Not async, so that the promise returned is the synchronization itself, and a caller resumes right after it ends: each step added
   * before an order report queues its event may push the event past the flush of its bucket, to the next one.
   */
  private synchronize(startedAfter = 0): Promise<void> {
    if (!this.synchronization) return this.startSynchronization();
    if (this.synchronizationCount > startedAfter) return this.synchronization;
    return this.synchronizeOnceEnded(this.synchronization, startedAfter);
  }

  private startSynchronization() {
    this.synchronizationCount++;
    const synchronization = this.runSynchronization();
    this.synchronization = synchronization;
    // Registered first, it runs before the callers resume, and before any other synchronization can start. Its own promise always
    // fulfils: no unhandled rejection here, the failure is the callers' to handle.
    const release = () => {
      this.synchronization = null;
    };
    synchronization.then(release, release);
    return synchronization;
  }

  /** Waits for a synchronization to end, whatever its outcome (the failure is the callers' it was shared with), then synchronizes */
  private async synchronizeOnceEnded(synchronization: Promise<void>, startedAfter: number) {
    await synchronization.catch(noop);
    return this.synchronize(startedAfter);
  }

  private async runSynchronization() {
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
        this.addDeferredEmit<Portfolio>(PORTFOLIO_CHANGE_EVENT, this.portfolio);
        this.lastEmittedPortfolio = clonePortfolio(this.portfolio);
      }
    } else {
      this.addDeferredEmit<Portfolio>(PORTFOLIO_CHANGE_EVENT, this.portfolio);
    }
  }

  /**
   * A synchronization nobody waits for: the first one, and the periodic ones in realtime. Skipped while one is in flight, whose
   * outcome it would only share. A failure is logged rather than thrown, which would make it an unhandled rejection: it is not
   * fatal, the next synchronization tries again.
   */
  private synchronizeInBackground() {
    if (this.synchronization) return debug('trader', 'Synchronization skipped: another one is in flight');
    this.synchronize().catch(err => error('trader', `Impossible to synchronize: ${getErrorMessage(err)}`));
  }

  /* -------------------------------------------------------------------------- */
  /*                               ORDER CHECKS                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * In backtest, runs once per bucket the check an interval runs every orderSynchInterval in realtime, which nothing else runs there.
   * Only a STICKY order needs it: the check moves the order once the market has gone past its price, as live. Unchecked, it stayed at
   * the price of the minute it was placed at: never filled once the market had run away from it, or filled when the market came back,
   * at a better price than live. A LIMIT order rests at its price and a MARKET order executes at its creation: the simulated exchange
   * settles both through the callback of their creation, and a check would only read back what it reported, for every open order at
   * every minute (a grid keeps dozens open).
   * The simulated exchange settles the bucket before the plugins run (see PluginsStream): the check sees the fills of the minute, and
   * the close as the ticker. An order already over, whose report has not removed it yet, is still listed: its check does nothing. A
   * check reports its failures through the events of the order and never rejects: a rejection would only be logged, not fail the bucket.
   */
  private async checkStickyOrders() {
    const checks = [...this.orders]
      .filter(([, { type }]) => type === 'STICKY')
      .map(([id, { orderInstance, side, type }]) =>
        orderInstance
          .checkOrder()
          .catch(err => error('trader', `[${id}] Impossible to check the ${side} ${type} order: ${getErrorMessage(err)}`)),
      );
    await Promise.all(checks);
  }

  /* -------------------------------------------------------------------------- */
  /*                             PRIVATE FUNCTIONS                              */
  /* -------------------------------------------------------------------------- */

  private checkOrderSummary({ id, symbol, type, orderCreationDate, summary }: CheckOrderSummaryParams): OrderCompletedEvent {
    const { amount, price, feePercent, side, orderExecutionDate } = summary;
    const { effectivePrice, fee } = computeOrderPricing(side, price, amount, feePercent);

    if (Number.isNaN(price)) {
      error(
        'trader',
        `[${id}] Order Summary: price is NaN. This usually happens when the exchange returns invalid data or the order was not filled correctly.`,
      );
    } else {
      if (isNil(feePercent) || !Number.isFinite(feePercent))
        warning('trader', 'Exchange did not provide fee information, assuming no fees.');
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
    }

    const currentPrice = this.prices.get(symbol) ?? 0;
    const order = { ...summary, id, orderCreationDate, type, fee, effectivePrice, symbol };
    const exchange = { price: currentPrice, portfolio: this.portfolio };
    return { order, exchange };
  }

  /**
   * The summary of a completed order, or undefined when it cannot be created (trades not fetched, invalid exchange data). The
   * order is then reported as errored instead: the strategy waits for a terminal event of every order it created.
   */
  private async summarizeCompletedOrder(orderInstance: OrderInstance, order: RelayedOrder, startedAfter: number) {
    try {
      return await orderInstance.createSummary();
    } catch (err) {
      const reason = getErrorMessage(err);
      error('trader', `[${order.id}] ${order.side} ${order.type} order completed, but its summary could not be created: ${reason}`);
      await this.relayError(order, reason, startedAfter);
    }
  }

  /**
   * Forgets an order that ended in error, or that the exchange refused, then relays ORDER_ERRORED_EVENT. Neither changed the
   * portfolio: any synchronization will do (see synchronize), unless a fill came first, whose summary failed (`startedAfter`).
   * The synchronization is best effort, here as in every report: a failure is logged, and the event leaves with the portfolio
   * known, since the strategy waits for it whatever happens. It is awaited right here, not through a wrapper, which would add a
   * step before the event (see synchronize).
   */
  private async relayError(order: RelayedOrder, reason: string, startedAfter?: number) {
    this.orders.delete(order.id);
    try {
      await this.synchronize(startedAfter);
    } catch (err) {
      error('trader', `[${order.id}] Impossible to synchronize: ${getErrorMessage(err)}`);
    }
    const exchange = { price: this.prices.get(order.symbol) || 0, portfolio: this.portfolio };
    this.addDeferredEmit<OrderErroredEvent>(ORDER_ERRORED_EVENT, {
      order: { ...order, reason, orderErrorDate: this.currentTimestamp },
      exchange,
    });
  }

  /* -------------------------------------------------------------------------- */
  /*                            ORDER TERMINAL EVENTS                           */
  /* -------------------------------------------------------------------------- */

  /**
   * Relays the end of an order to the strategy, which waits for an ORDER_COMPLETED_EVENT, an ORDER_CANCELED_EVENT or an
   * ORDER_ERRORED_EVENT of every order it created. The four ways an order ends are listened to in both flows, creation and
   * cancelation: an order the strategy waits to see filled can be canceled by the exchange (expired, canceled from its interface),
   * and the creation a cancelation waits for can be refused.
   *
   * An EventEmitter ignores the promise an async listener returns: each report catches its own failures, which would otherwise
   * become unhandled rejections. Each one starts by removing every listener of the order, synchronously, before its first await:
   * the first terminal event an order emits is the only one relayed, a later one (a fill after an error, an error repeated) is
   * ignored, and the strategy hears once of each order. Doing so while the order emits is safe: an EventEmitter calls a copy of the
   * listeners it had when emit began, and the status and fill logs come first, emitted before the terminal event.
   */
  private relayTerminalEvents(orderInstance: OrderInstance, order: RelayedOrder) {
    orderInstance.once(ORDER_COMPLETED_EVENT, () => this.reportCompleted(orderInstance, order));
    orderInstance.once(ORDER_CANCELED_EVENT, (cancelation: OrderCancelation) => this.reportCanceled(orderInstance, order, cancelation));
    orderInstance.once(ORDER_ERRORED_EVENT, (reason: string) => this.reportErrored(orderInstance, order, reason));
    orderInstance.once(ORDER_INVALID_EVENT, (rejection: OrderRejection) => this.reportRejected(orderInstance, order, rejection));
  }

  /** The fill, with its summary and the portfolio after it; an error instead when it cannot be summarized */
  private async reportCompleted(orderInstance: OrderInstance, order: RelayedOrder) {
    const { id, symbol, side, type, orderCreationDate } = order;
    try {
      orderInstance.removeAllListeners();
      const startedAfter = this.synchronizationCount;
      const summary = await this.summarizeCompletedOrder(orderInstance, order, startedAfter);
      if (!summary) return;
      // The portfolio after the fill, best effort (see relayError)
      try {
        await this.synchronize(startedAfter);
      } catch (err) {
        error('trader', `[${id}] Impossible to synchronize: ${getErrorMessage(err)}`);
      }
      const orderCompletedEvent = this.checkOrderSummary({ id, symbol, type, orderCreationDate, summary });
      this.addDeferredEmit<OrderCompletedEvent>(ORDER_COMPLETED_EVENT, orderCompletedEvent);
      this.orders.delete(id);
    } catch (err) {
      error('trader', `[${id}] Impossible to report the completion of the ${side} ${type} order: ${getErrorMessage(err)}`);
    }
  }

  /** The cancelation, whoever canceled the order: the strategy, or the exchange (expired, canceled from its interface) */
  private async reportCanceled(orderInstance: OrderInstance, order: RelayedOrder, cancelation: OrderCancelation) {
    const { id, symbol, side, type } = order;
    try {
      orderInstance.removeAllListeners();
      const startedAfter = this.synchronizationCount;
      const { timestamp, filled, remaining } = cancelation;
      info('trader', `[${id}] ${side} ${type} order canceled (filled: ${filled}, remaining: ${remaining})`);
      this.orders.delete(id);
      // The portfolio once what the order reserved is released, best effort (see relayError)
      try {
        await this.synchronize(startedAfter);
      } catch (err) {
        error('trader', `[${id}] Impossible to synchronize: ${getErrorMessage(err)}`);
      }
      const exchange = { price: this.prices.get(symbol) ?? 0, portfolio: this.portfolio };
      this.addDeferredEmit<OrderCanceledEvent>(ORDER_CANCELED_EVENT, {
        order: { ...order, orderCancelationDate: timestamp, filled, remaining },
        exchange,
      });
    } catch (err) {
      error('trader', `[${id}] Impossible to report the cancelation of the ${side} ${type} order: ${getErrorMessage(err)}`);
    }
  }

  private async reportErrored(orderInstance: OrderInstance, order: RelayedOrder, reason: string) {
    const { id, side, type } = order;
    try {
      orderInstance.removeAllListeners();
      error('trader', `[${id}] ${side} ${type} order: ${reason} (status: ERROR)`);
      await this.relayError(order, reason);
    } catch (err) {
      error('trader', `[${id}] Impossible to report the error of the ${side} ${type} order: ${getErrorMessage(err)}`);
    }
  }

  /** The refusal of the order by the exchange, which the strategy hears of as an error */
  private async reportRejected(orderInstance: OrderInstance, order: RelayedOrder, rejection: OrderRejection) {
    const { id, side, type } = order;
    try {
      orderInstance.removeAllListeners();
      const { reason, status, filled } = rejection;
      info('trader', `[${id}] ${side} ${type} order: ${reason} (filled: ${filled}, status: ${status})`);
      await this.relayError(order, reason);
    } catch (err) {
      error('trader', `[${id}] Impossible to report the rejection of the ${side} ${type} order: ${getErrorMessage(err)}`);
    }
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
    // Parallel strategy: process all payloads concurrently. An id asked twice in the same batch is canceled once.
    await Promise.all(
      uniq(payloads).map(async id => {
        const orderMetadata = this.orders.get(id);
        if (!orderMetadata) return warning('trader', `[${id}] Impossible to cancel order: Unknown Order`);
        const { orderInstance, side, amount, type, orderCreationDate, price, symbol } = orderMetadata;

        // From now on its updates are no longer logged, and its end is relayed with the price it was placed at (the creation flow
        // relays the price the strategy asked for, if any)
        orderInstance.removeAllListeners();
        this.relayTerminalEvents(orderInstance, { id, orderCreationDate, amount, side, type, price, symbol });

        // Cancel, without waiting: the outcome arrives through the terminal events. A failure is reported as ORDER_ERRORED_EVENT,
        // so a rejection is not expected, but it must not become an unhandled one
        orderInstance
          .cancel()
          .catch(err => error('trader', `[${id}] Impossible to cancel the ${side} ${type} order: ${getErrorMessage(err)}`));
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

        // TERMINAL EVENTS, relayed with the order as initiated
        this.relayTerminalEvents(orderInstance, orderInitiated);

        // Launch the order, without waiting: the outcome arrives through the terminal events. A failure is reported as
        // ORDER_ERRORED_EVENT, so a rejection is not expected, but it must not become an unhandled one
        orderInstance
          .launch()
          .catch(err => error('trader', `[${id}] Impossible to launch the ${side} ${type} order: ${getErrorMessage(err)}`));
      }),
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                           PLUGIN LIFECYCLE HOOKS                           */
  /* -------------------------------------------------------------------------- */

  protected processInit(): void {
    if (this.mode === 'realtime') {
      const exchangeSync = config.getExchange().exchangeSynchInterval;
      this.syncInterval = setInterval(() => this.synchronizeInBackground(), exchangeSync);
    }
    this.synchronizeInBackground();
  }

  protected async processOneMinuteBucket(bucket: CandleBucket) {
    // Throw error if bucket is empty
    const firstEntry = getFirstCandleFromBucket(bucket);

    // Update warmup candle bucket until warmup is completed
    if (!this.warmupCompleted) this.warmupBucket = bucket;

    // Update all candle bucket prices
    for (const [symbol, candle] of bucket) this.prices.set(symbol, candle.close);

    if (this.mode === 'backtest') {
      // Check the orders before the synchronization, which then sees what a move reserves (see checkStickyOrders)
      await this.checkStickyOrders();

      // Synchronize periodically in backtest mode (order fills are handled by exchange callbacks)
      const minutes = differenceInMinutes(firstEntry.start, 0);
      if (this.currentTimestamp && minutes % getBacktestModeIntervalSyncTime(this.timeframe) === 0) await this.synchronize();
    }

    // Update timestamp last to detect the first execution for backtest mode sync above
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
