import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TIMEFRAME_CANDLE_EVENT,
} from '@constants/event.const';
import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { AdviceOrder } from '@models/advice.types';
import { CandleBucket, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { TradingPair } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { CandleBucketBatcher } from '@services/core/batcher/candleBatcher/candleBucketBatcher';
import { MarketData } from '@services/exchange/exchange.types';
import { info } from '@services/logger';
import { StrategyManager } from '@strategies/strategyManager';
import { bindAll, filter } from 'lodash-es';
import { UUID } from 'node:crypto';
import { tradingAdvisorSchema } from './tradingAdvisor.schema';
import { TradingAdvisorConfiguration } from './tradingAdvisor.types';

/**
 * Whether the portfolio an order event carries was read from the exchange: until one of its synchronizations succeeds, the Trader
 * relays the end of an order with the empty portfolio it starts with, while the balance of an exchange always lists the asset and the
 * currency of every watched pair. The analyzers go by the same rule.
 */
const isFetchedPortfolio = (portfolio: Portfolio) => portfolio.size > 0;

export class TradingAdvisor extends Plugin {
  private bucketBatcher: CandleBucketBatcher;
  private strategyName: string;
  private strategyPath?: string;
  private strategyManager?: StrategyManager;
  private maxConsecutiveErrors: number;

  constructor({ name, strategyName, strategyPath, maxConsecutiveErrors }: TradingAdvisorConfiguration) {
    super(name);
    this.strategyName = strategyName;
    this.strategyPath = strategyPath;
    this.maxConsecutiveErrors = maxConsecutiveErrors;

    const timeframeInMinutes = TIMEFRAME_TO_MINUTES[this.timeframe!]; // Timeframe will always defined in thanks to zod super refine
    this.bucketBatcher = new CandleBucketBatcher(this.pairs, timeframeInMinutes);

    const relayers = filter(Object.getOwnPropertyNames(TradingAdvisor.prototype), p => p.startsWith('relay'));
    bindAll(this, [...relayers]);
  }

  // --- BEGIN INTERNALS ---
  private async setUpStrategy() {
    this.strategyManager = new StrategyManager(this.warmupPeriod, this.maxConsecutiveErrors);
    await this.strategyManager.createStrategy(this.strategyName, this.strategyPath);
  }

  private setUpListeners() {
    this.strategyManager
      ?.on(STRATEGY_WARMUP_COMPLETED_EVENT, this.relayStrategyWarmupCompleted)
      .on(STRATEGY_CREATE_ORDER_EVENT, this.relayCreateOrder)
      .on(STRATEGY_CANCEL_ORDER_EVENT, this.relayCancelOrder)
      .on(STRATEGY_INFO_EVENT, this.relayStrategyInfo);
  }

  /**
   * Gives the strategy the portfolio the last of these order events carries, which the Trader read once the order had ended: the candle
   * hooks get it from the next candle on. Only a portfolio change refreshed it, which the Trader's portfolioUpdates filter holds back
   * for a fill below its threshold: the candle hooks kept the balance from before the fill, and an all-in order sized on it was refused.
   * The last event of a batch carries the latest portfolio: the Trader queues each one with the portfolio it read last.
   */
  private refreshPortfolio(payloads: OrderInitiatedEvent[]) {
    const { portfolio } = payloads[payloads.length - 1].exchange;
    if (isFetchedPortfolio(portfolio)) this.strategyManager?.onPortfolioChange(portfolio);
  }

  /* -------------------------------------------------------------------------- */
  /*                           EVENTS EMITERS                                   */
  /* -------------------------------------------------------------------------- */

  private relayStrategyWarmupCompleted(event: CandleBucket) {
    this.addDeferredEmit<CandleBucket>(STRATEGY_WARMUP_COMPLETED_EVENT, event);
  }

  private relayCancelOrder(orderId: UUID) {
    this.addDeferredEmit<UUID>(STRATEGY_CANCEL_ORDER_EVENT, orderId);
  }

  private relayCreateOrder(advice: AdviceOrder) {
    this.addDeferredEmit<AdviceOrder>(STRATEGY_CREATE_ORDER_EVENT, advice);
  }

  private relayStrategyInfo(strategyInfo: StrategyInfo) {
    this.addDeferredEmit<StrategyInfo>(STRATEGY_INFO_EVENT, strategyInfo);
  }

  /* -------------------------------------------------------------------------- */
  /*                          EVENT LISTENERS                                   */
  /* -------------------------------------------------------------------------- */

  public async onOrderCompleted(payloads: OrderCompletedEvent[]) {
    await Promise.all(
      payloads.map(order => {
        this.strategyManager?.onOrderCompleted(order);
      }),
    );
    this.refreshPortfolio(payloads);
  }

  public async onOrderCanceled(payloads: OrderCanceledEvent[]) {
    await Promise.all(
      payloads.map(order => {
        this.strategyManager?.onOrderCanceled(order);
      }),
    );
    this.refreshPortfolio(payloads);
  }

  public async onOrderErrored(payloads: OrderErroredEvent[]) {
    await Promise.all(
      payloads.map(order => {
        this.strategyManager?.onOrderErrored(order);
      }),
    );
    this.refreshPortfolio(payloads);
  }

  public onPortfolioChange(payloads: Portfolio[]) {
    const portfolio = payloads[payloads.length - 1];
    this.strategyManager?.onPortfolioChange(portfolio);
  }

  /* -------------------------------------------------------------------------- */
  /*                         PLUGIN LIFECYCLE HOOKS                             */
  /* -------------------------------------------------------------------------- */

  protected async processInit() {
    await this.setUpStrategy();
    this.setUpListeners();

    // Set up market data for all watched pairs
    const exchange = this.getExchange();
    const allMarketData = new Map<TradingPair, MarketData>();
    for (const symbol of this.pairs) allMarketData.set(symbol, exchange.getMarketData(symbol));
    this.strategyManager?.setMarketData(allMarketData);

    const balance = await exchange.fetchBalance();
    this.strategyManager?.onPortfolioChange(balance);
    info('trading advisor', `Using the strategy: ${this.strategyName}`);
  }

  protected processOneMinuteBucket(bucket: CandleBucket) {
    this.strategyManager?.onOneMinuteBucket(bucket);

    const timeframeBucket = this.bucketBatcher.addBucket(bucket);
    if (timeframeBucket) {
      // Queued after the hooks, and so after the warmup event of the same candle, which the PortfolioAnalyzer waits for before it marks
      // a candle. The hooks got their own copy of the bucket (see StrategyManager.onTimeFrameCandle): what they wrote is not in this one.
      this.strategyManager?.onTimeFrameCandle(timeframeBucket);
      this.addDeferredEmit<CandleBucket>(TIMEFRAME_CANDLE_EVENT, timeframeBucket);
    }
  }

  protected processFinalize() {
    this.strategyManager?.onStrategyEnd();
  }

  /* -------------------------------------------------------------------------- */
  /*                           PLUGIN CONFIGURATION                             */
  /* -------------------------------------------------------------------------- */

  public static getStaticConfiguration() {
    return {
      name: 'TradingAdvisor',
      schema: tradingAdvisorSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: ['exchange'],
      eventsHandlers: filter(Object.getOwnPropertyNames(TradingAdvisor.prototype), p => p.startsWith('on')),
      eventsEmitted: [
        STRATEGY_INFO_EVENT,
        STRATEGY_CREATE_ORDER_EVENT,
        STRATEGY_CANCEL_ORDER_EVENT,
        STRATEGY_WARMUP_COMPLETED_EVENT,
        TIMEFRAME_CANDLE_EVENT,
      ],
    } as const;
  }
}
