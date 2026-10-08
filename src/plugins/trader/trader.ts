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
import { AdviceOrder } from '@models/advice.types';
import { CandleBucket, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { config } from '@services/configuration/configuration';
import { OrderSummary } from '@services/core/order/order.types';
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
/** What an order reports with ORDER_INVALID_EVENT (see Order.orderRejected): `filled` says whether it executed part of its amount */
type OrderRejection = { reason: string; status: string; filled: boolean };
/** What an order reports with ORDER_CANCELED_EVENT (see Order.orderCanceled): relayed as is */
type OrderCancelation = { timestamp: EpochTimeStamp } & Pick<OrderCanceledEvent['order'], 'filled' | 'remaining'>;

export class Trader extends Plugin {
  private readonly orders: Map<UUID, TraderOrderMetadata>;
  private readonly portfolioUpdatesConfig: PortfolioUpdatesConfig | null;

  private portfolio: Portfolio = createEmptyPortfolio();
  private prices: Map<TradingPair, number> = new Map();
  private currentTimestamp: EpochTimeStamp = 0;
  private syncInterval: NodeJS.Timeout | null = null;
  private lastEmittedPortfolio: Portfolio | null = null;
  /** The synchronization in flight, if any (see synchronize) */
  private synchronization: Promise<void> | null = null;
  /** How many synchronizations have started: whoever notes the count knows which ones read the exchange after that moment */
  private synchronizationCount = 0;
  /**
   * What may still queue the end of an order: the reports in flight (see relayTerminalEvents), and the launches and cancelations
   * sent, whose answer may end the order and so start a report. Each one leaves the set once settled. None rejects: each catches
   * its own failures.
   */
  private readonly pendingReports = new Set<Promise<void>>();

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
   * what the order reserved), and so may one that ended in error or refused (see relayError): its event carries the portfolio after
   * that change. `startedAfter` is then the count of synchronizations started when the order ended, and one started before may have
   * read the exchange too early. The caller waits for it to end, then joins the next one, which all such callers share.
   *
   * Not async, so that the promise returned is the synchronization itself, and a caller resumes right after it ends.
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

    // Emit portfolio events if changes are detected. The filter holds back a change below its threshold, that of a fill included: the
    // end of an order carries the portfolio after it all the same (see relayError), which the TradingAdvisor and the analyzers take as
    // the latest
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

  /**
   * The amount a SELL is placed with: never more than the free balance of its asset, which the exchange refuses to exceed. A strategy
   * may ask for more without knowing it: the amount a BUY filled, which the trailing stop of that BUY sells (see StrategyManager), is
   * the amount of its trades, and the exchange may have taken the fee of the BUY from the asset bought, as Binance does unless the fees
   * are paid in BNB. The account then holds that amount less the fee: the SELL of the whole was refused, an error counting towards the
   * circuit breaker, the position left unprotected. The simulated exchange takes its fees in the currency: a backtest never showed it.
   * The balance is the one the last synchronization read, which followed the end of the last order (see reportCompleted): the Trader
   * does not read it again before placing an order. Left as asked for:
   * - an amount within the balance, or not a finite number (refused as before, rather than turned into the sale of every unit held);
   * - any amount while the balance is 0: maybe a portfolio not synchronized yet, and a SELL of 0 would be refused anyway.
   */
  private capToFreeBalance({ id, type }: AdviceOrder, requestedAmount: number, freeBalance: number, assetName: string) {
    const isAboveBalance = freeBalance > 0 && Number.isFinite(requestedAmount) && requestedAmount > freeBalance;
    if (!isAboveBalance) return requestedAmount;
    warning(
      'trader',
      `[${id}] SELL ${type} order of ${requestedAmount} ${assetName} above the free balance: ${freeBalance} ${assetName} sent, all that can be sold`,
    );
    return freeBalance;
  }

  private checkOrderSummary({ id, symbol, type, orderCreationDate, summary }: CheckOrderSummaryParams): OrderCompletedEvent {
    const { amount, price, feePercent, side, orderExecutionDate } = summary;
    const { effectivePrice, fee } = computeOrderPricing(side, price, amount, feePercent);

    // Defensive: a summary comes with a price, the exchange's or an estimate (see summarizeCompletedOrder), unless the Trader no
    // longer lists the order, and so may not know its price (see estimateExecutionPrice)
    if (Number.isNaN(price)) {
      error('trader', `[${id}] Order Summary: price is NaN, neither the exchange nor the Trader knows the price the order executed at.`);
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
   * The summary of a completed order. A fill is a fact: the order executed, and the position changed on the exchange. When the
   * exchange cannot summarize it (its trades out of reach once the retries are spent, or any failure after the fill), the summary is
   * estimated instead (see estimateOrderSummary), and the strategy still hears of a fill. Relayed as an error, it counted towards
   * the circuit breaker, dropped the trailing stop of the position the order opened, and let a strategy place the order again.
   *
   * So is a summary without a usable amount, price or execution date: createOrderSummary resolves with NaN ones when none of the
   * trades of the account matches the order (fetched from a bound past its fills, beyond the pages fetched, or not listed yet by the
   * exchange). Relayed as they were, they armed the trailing stop of the position with an amount of NaN, whose SELL was refused,
   * and the analyzers skipped or misdated the fill.
   */
  private async summarizeCompletedOrder(orderInstance: OrderInstance, order: RelayedOrder) {
    const isFinitePositive = (value: number) => Number.isFinite(value) && value > 0;
    let reason: string;
    try {
      const summary = await orderInstance.createSummary();
      const { amount, price, orderExecutionDate } = summary;
      if (isFinitePositive(amount) && isFinitePositive(price) && Number.isFinite(orderExecutionDate)) return summary;
      reason = `its trades were not found, or not usable (amount ${amount}, price ${price}, executed at ${toISOString(orderExecutionDate)})`;
    } catch (err) {
      reason = `its summary could not be created: ${getErrorMessage(err)}`;
    }
    return this.estimateOrderSummary(orderInstance, order, reason);
  }

  /**
   * A summary of a filled order estimated from what the Trader and the order know, for when the exchange gives none. It is logged
   * as an error, with `reason`, which completes "order filled, but", and the source of each figure:
   * - amount: the fills the order recorded, as the exchange reported them. Without any, the amount ordered, which a filled order
   *   executed in full, up to the lot rounding of the exchange.
   * - price: see estimateExecutionPrice.
   * - fee: unknown, which computeOrderPricing takes as no fee.
   * - execution date: the order does not know when it was filled: the end of the last minute processed.
   */
  private estimateOrderSummary(orderInstance: OrderInstance, order: RelayedOrder, reason: string): OrderSummary {
    const { id, side, type } = order;
    const filledAmount = orderInstance.getFilledAmount();
    const isFillReported = filledAmount > 0;
    const amount = isFillReported ? filledAmount : order.amount;
    const amountSource = isFillReported
      ? 'the fill reported'
      : 'the amount ordered: no fill reported, and a filled order executed it in full, up to lot rounding';
    const { price, priceSource } = this.estimateExecutionPrice(order);

    error(
      'trader',
      [
        `[${id}] ${side} ${type} order filled, but ${reason}. Its summary is estimated:`,
        `amount ${amount} (${amountSource}),`,
        `price ${price} (${priceSource}),`,
        'fee unknown,',
        `executed at ${toISOString(this.currentTimestamp)} (the end of the last minute processed)`,
      ].join(' '),
    );
    return { amount, price, side, feePercent: undefined, orderExecutionDate: this.currentTimestamp };
  }

  /**
   * The price a filled order executed at, estimated (see estimateOrderSummary): a LIMIT order executed at its price, or better. Any
   * other one at the market, which a STICKY order follows: the last price known, else the price the order was created with. That
   * price is kept with the order until its end is reported (see reportCompleted).
   */
  private estimateExecutionPrice({ id, symbol, type }: RelayedOrder) {
    const creationPrice = this.orders.get(id)?.price ?? NaN;
    if (type === 'LIMIT') return { price: creationPrice, priceSource: 'its limit price' };

    const marketPrice = this.prices.get(symbol) ?? NaN;
    if (marketPrice > 0) return { price: marketPrice, priceSource: 'the last market price' };
    return { price: creationPrice, priceSource: 'the price it was created with: no market price known' };
  }

  /**
   * Forgets an order that ended in error, or that the exchange refused, then relays ORDER_ERRORED_EVENT with the portfolio from a
   * synchronization started after that end (`startedAfter`, see synchronize), as every report does. Either may follow a change of
   * the portfolio: an error may come after the order executed, in part or in full (a STICKY order reports what it had already
   * filled, a poll can fail for good after a fill, a creation whose outcome is unknown may be live), and the relaunch of a STICKY
   * order is refused once its move has canceled the transaction before, releasing what it reserved. The synchronization is best
   * effort, here as in every report: a failure is logged, and the event leaves with the portfolio known, since the strategy waits
   * for it whatever happens.
   * The event carries what the order had filled (`filled`, see Order.getFilledAmount): only a STICKY order's reason told it, in words,
   * and a BUY that errored after a fill lost the trailing stop of the coins it had bought (see StrategyManager.onOrderErrored).
   */
  private async relayError(order: RelayedOrder, reason: string, startedAfter: number, filled: number) {
    this.orders.delete(order.id);
    try {
      await this.synchronize(startedAfter);
    } catch (err) {
      error('trader', `[${order.id}] Impossible to synchronize: ${getErrorMessage(err)}`);
    }
    const exchange = { price: this.prices.get(order.symbol) || 0, portfolio: this.portfolio };
    this.addDeferredEmit<OrderErroredEvent>(ORDER_ERRORED_EVENT, {
      order: { ...order, reason, orderErrorDate: this.currentTimestamp, filled },
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
   *
   * A report queues its event several exchange calls after the order ended (the summary, the synchronization), and the events of a
   * bucket are flushed once, as soon as the plugins have processed it (see PluginsStream). Each report is kept in pendingReports:
   * - in backtest, they are awaited before the events are flushed (see processOneMinuteBucket and broadcastDeferredEmit), and so are
   *   the launches and cancelations: the simulated exchange answers within a few ticks. The end of an order it settles with a bucket
   *   is delivered with that bucket, and that of an order it ends at once, created or canceled during the flush of the TradingAdvisor,
   *   in the flush of the Trader that follows. Left to race the flush, a fill reached the strategy and the analyzers one or two
   *   candles late, the count depending on how many ticks each step took (even on the STICKY orders open), and a fill on the last
   *   bucket was never delivered: nothing is flushed after processFinalize.
   * - in realtime, paper trading included, a report waits for the network: awaited, it would hold the bucket, and every plugin, for
   *   as long as the exchange takes to answer. It is delivered with the first flush after it ends.
   */
  private relayTerminalEvents(orderInstance: OrderInstance, order: RelayedOrder) {
    orderInstance.once(ORDER_COMPLETED_EVENT, () => this.trackReport(this.reportCompleted(orderInstance, order)));
    orderInstance.once(ORDER_CANCELED_EVENT, (cancelation: OrderCancelation) =>
      this.trackReport(this.reportCanceled(orderInstance, order, cancelation)),
    );
    orderInstance.once(ORDER_ERRORED_EVENT, (reason: string) => this.trackReport(this.reportErrored(orderInstance, order, reason)));
    orderInstance.once(ORDER_INVALID_EVENT, (rejection: OrderRejection) =>
      this.trackReport(this.reportRejected(orderInstance, order, rejection)),
    );
  }

  /** Keeps a report, or a call that may start one, in pendingReports until it settles. It is returned as is. */
  private trackReport(report: Promise<void>) {
    this.pendingReports.add(report);
    const release = () => this.pendingReports.delete(report);
    report.then(release, release);
    return report;
  }

  /** Waits until no report is in flight: the one awaited may start another (a launch ends in a fill, which is then reported) */
  private async settlePendingReports() {
    while (this.pendingReports.size) await Promise.all(this.pendingReports);
  }

  /** The fill, with its summary, estimated when the exchange cannot give it (see summarizeCompletedOrder), and the portfolio after it */
  private async reportCompleted(orderInstance: OrderInstance, order: RelayedOrder) {
    const { id, symbol, side, type, orderCreationDate } = order;
    try {
      orderInstance.removeAllListeners();
      const startedAfter = this.synchronizationCount;
      const summary = await this.summarizeCompletedOrder(orderInstance, order);
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

  /** The error, what the order filled before it, and the portfolio after it: the order may have executed before (see relayError) */
  private async reportErrored(orderInstance: OrderInstance, order: RelayedOrder, reason: string) {
    const { id, side, type } = order;
    try {
      orderInstance.removeAllListeners();
      const startedAfter = this.synchronizationCount;
      error('trader', `[${id}] ${side} ${type} order: ${reason} (status: ERROR)`);
      await this.relayError(order, reason, startedAfter, orderInstance.getFilledAmount());
    } catch (err) {
      error('trader', `[${id}] Impossible to report the error of the ${side} ${type} order: ${getErrorMessage(err)}`);
    }
  }

  /**
   * The refusal of the order by the exchange, which the strategy hears of as an error. Unless the order had executed part of what it
   * ordered: a STICKY order whose relaunch after a move is refused (see StickyOrder.handleCreateOrderError) is over with what its
   * earlier transactions filled, each of them seen canceled, nothing left on the exchange. That part is reported as a completion,
   * its summary created, or estimated (see reportCompleted), as when what is left is out of the limits of the market, which the
   * order takes for its fill (OrderOutOfRangeError). Relayed as an error, the strategy never heard of the fill, the trailing stop of
   * the position was not armed, and the analyzers missed it. The amount the order filled is read from it (see
   * Order.getFilledAmount): its rejection only says whether it filled anything.
   */
  private async reportRejected(orderInstance: OrderInstance, order: RelayedOrder, rejection: OrderRejection) {
    const { id, side, type, amount } = order;
    try {
      orderInstance.removeAllListeners();
      const startedAfter = this.synchronizationCount;
      const { reason, status, filled } = rejection;
      const filledAmount = orderInstance.getFilledAmount();
      if (filledAmount > 0) {
        const fill = `after ${filledAmount} of ${amount} filled: that part is reported as a completion`;
        warning('trader', `[${id}] ${side} ${type} order: ${reason} (status: ${status}), ${fill}`);
        await this.reportCompleted(orderInstance, order);
        return;
      }
      info('trader', `[${id}] ${side} ${type} order: ${reason} (filled: ${filled}, status: ${status})`);
      await this.relayError(order, reason, startedAfter, filledAmount);
    } catch (err) {
      error('trader', `[${id}] Impossible to report the rejection of the ${side} ${type} order: ${getErrorMessage(err)}`);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                             EVENT LISTENERS                                */
  /* -------------------------------------------------------------------------- */

  /**
   * Emits the portfolio at the end of the warmup, when the PortfolioAnalyzer starts recording the equity. The bucket that ended the
   * warmup was processed as it arrived, like every bucket: nothing else is left to do. Best effort, like every synchronization of the
   * plugin (see relayError): a rejection leaving the handler would end the run (see PluginsStream), and the next synchronization
   * tries again.
   */
  public async onStrategyWarmupCompleted(_bucket: CandleBucket[]) {
    try {
      await this.synchronize();
    } catch (err) {
      error('trader', `[warmup] Impossible to synchronize: ${getErrorMessage(err)}`);
    }
  }

  public async onStrategyCancelOrder(payloads: UUID[]) {
    // Parallel strategy: process all payloads concurrently. An id asked twice in the same batch is canceled once.
    await Promise.all(
      uniq(payloads).map(async id => {
        const orderMetadata = this.orders.get(id);
        if (!orderMetadata) return warning('trader', `[${id}] Impossible to cancel order: Unknown Order`);
        const { orderInstance, side, amount, type, orderCreationDate, requestedPrice, symbol } = orderMetadata;

        // From now on its updates are no longer logged, and its end is relayed as the creation flow relays it: with the price the
        // strategy asked for, if any. Not the price the order was created with (see TraderOrderMetadata), the market price for an
        // order without one, which the strategy and the EventSubscriber would read as a requested limit price.
        orderInstance.removeAllListeners();
        this.relayTerminalEvents(orderInstance, { id, orderCreationDate, amount, side, type, price: requestedPrice, symbol });

        // Cancel, without waiting: the outcome arrives through the terminal events. A failure is reported as ORDER_ERRORED_EVENT,
        // so a rejection is not expected, but it must not become an unhandled one. Tracked as a report: the simulated exchange
        // answers at once, and its answer ends the order (see relayTerminalEvents).
        this.trackReport(
          orderInstance
            .cancel()
            .catch(err => error('trader', `[${id}] Impossible to cancel the ${side} ${type} order: ${getErrorMessage(err)}`)),
        );
      }),
    );
  }

  public async onStrategyCreateOrder(payloads: AdviceOrder[]) {
    // Parallel strategy: process all payloads concurrently
    await Promise.all(
      payloads.map(async advice => {
        const { id, side, orderCreationDate, type, symbol } = advice;
        const price = advice.price ?? this.prices.get(symbol);
        // Unknown (a pair not watched), 0, negative or NaN: the order can be neither sized nor placed. The strategy already holds its
        // id and waits for a terminal event of it: it hears of it as an error, like an order the exchange refused. Nothing was
        // initiated and nothing changed on the exchange: no ORDER_INITIATED_EVENT, no synchronization, the event leaves with the
        // portfolio known.
        if (!price || price <= 0) {
          const reason = isNil(advice.price) ? `no price known for ${symbol}` : `invalid requested price ${advice.price}`;
          warning('trader', `[${id}] Impossible to create the ${side} ${type} order: ${reason}`);
          // The amount the strategy asked for, if any. Without one the order was all-in, to be sized as it is placed (a BUY from the
          // price, missing or invalid here): never placed, it ordered nothing, and filled nothing.
          const order = { ...advice, amount: advice.amount ?? 0, reason, orderErrorDate: this.currentTimestamp, filled: 0 };
          const exchange = { price: this.prices.get(symbol) || 0, portfolio: this.portfolio };
          this.addDeferredEmit<OrderErroredEvent>(ORDER_ERRORED_EVENT, { order, exchange });
          return;
        }

        const [assetName, currencyName] = symbol.split('/');
        const asset = getAssetBalance(this.portfolio, assetName);
        const currency = getAssetBalance(this.portfolio, currencyName);

        // Price cannot be zero here because we call processOneMinuteBucket before events (plugins stream)
        // We delegate the order validation (notional, lot, amount) to the exchange
        const computedAmount = side === 'BUY' ? (currency.free / price) * (1 - DEFAULT_FEE_BUFFER) : asset.free;
        const requestedAmount = advice.amount ?? computedAmount;
        const amount = side === 'SELL' ? this.capToFreeBalance(advice, requestedAmount, asset.free, assetName) : requestedAmount;

        // Emit order initiated event
        const orderInitiated = { ...advice, amount, symbol };
        const exchange = { price: this.prices.get(symbol) || 0, portfolio: this.portfolio };
        this.addDeferredEmit<OrderInitiatedEvent>(ORDER_INITIATED_EVENT, { order: orderInitiated, exchange });

        // Create order
        const orderInstance = new ORDER_FACTORY[type](symbol, id, side, amount, price);
        this.orders.set(id, { amount, side, orderCreationDate, type, price, requestedPrice: advice.price, orderInstance, symbol });

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
        // ORDER_ERRORED_EVENT, so a rejection is not expected, but it must not become an unhandled one. Tracked as a report: the
        // simulated exchange may end the order at its launch, a MARKET order filled at once (see relayTerminalEvents).
        this.trackReport(
          orderInstance
            .launch()
            .catch(err => error('trader', `[${id}] Impossible to launch the ${side} ${type} order: ${getErrorMessage(err)}`)),
        );
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
    // The first execution, which the backtest mode sync below skips
    const isFirstBucket = !this.currentTimestamp;

    // Update all candle bucket prices, and the time: the end of the minute, where the clock of the simulated exchange already is
    // (see PluginsStream). A report settled during the bucket dates an estimated fill, or an error, with it.
    for (const [symbol, candle] of bucket) this.prices.set(symbol, candle.close);
    this.currentTimestamp = addMinutes(firstEntry.start, 1).getTime();

    if (this.mode === 'backtest') {
      // Check the orders before the synchronization, which then sees what a move reserves (see checkStickyOrders)
      await this.checkStickyOrders();

      // Synchronize periodically in backtest mode (order fills are handled by exchange callbacks)
      const minutes = differenceInMinutes(firstEntry.start, 0);
      if (!isFirstBucket && minutes % getBacktestModeIntervalSyncTime(this.timeframe) === 0) await this.synchronize();

      // The ends of orders the simulated exchange settled with this bucket, or the checks above, are queued before its events are
      // flushed, and delivered with it (see relayTerminalEvents)
      await this.settlePendingReports();
    }
  }

  /**
   * Delivers the oldest group of deferred events (see SequentialEventEmitter). In backtest, once the reports in flight are queued: the
   * flush of the TradingAdvisor, which comes first, creates and cancels orders, and the simulated exchange ends some of them at once
   * (see relayTerminalEvents).
   */
  public async broadcastDeferredEmit(): Promise<boolean> {
    if (this.mode === 'backtest') await this.settlePendingReports();
    return super.broadcastDeferredEmit();
  }

  protected async processFinalize() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    // Nothing is flushed any more, but in backtest the reports in flight end before the run does, their logs complete
    if (this.mode === 'backtest') await this.settlePendingReports();
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
