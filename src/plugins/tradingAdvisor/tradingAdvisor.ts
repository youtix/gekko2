import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TIMEFRAME_CANDLE_EVENT,
} from '@constants/event.const';
import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { GekkoError } from '@errors/gekko.error';
import { AdviceOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { Portfolio } from '@models/portfolio.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Plugin } from '@plugins/plugin';
import { CandleBatcher } from '@services/core/batcher/candleBatcher/candleBatcher';
import { CandleSize } from '@services/core/batcher/candleBatcher/candleBatcher.types';
import { info } from '@services/logger';
import { StrategyManager } from '@strategies/strategyManager';
import { bindAll, filter } from 'lodash-es';
import { UUID } from 'node:crypto';
import { tradingAdvisorSchema } from './tradingAdvisor.schema';
import { TradingAdvisorConfiguration } from './tradingAdvisor.types';

export class TradingAdvisor extends Plugin {
  private candleBatcher: CandleBatcher;
  private timeframeInMinutes: CandleSize;
  private strategyName: string;
  private strategyPath?: string;
  private candle?: Candle;
  private strategyManager?: StrategyManager;

  constructor({ name, strategyName, strategyPath }: TradingAdvisorConfiguration) {
    super(name);
    this.strategyName = strategyName;
    this.strategyPath = strategyPath;
    this.timeframeInMinutes = TIMEFRAME_TO_MINUTES[this.timeframe];
    this.candleBatcher = new CandleBatcher(this.timeframeInMinutes);

    const relayers = filter(Object.getOwnPropertyNames(TradingAdvisor.prototype), p => p.startsWith('relay'));
    bindAll(this, [...relayers]);
  }

  // --- BEGIN INTERNALS ---
  private async setUpStrategy() {
    this.strategyManager = new StrategyManager(this.warmupPeriod);
    await this.strategyManager.createStrategy(this.strategyName, this.strategyPath);
  }

  private setUpListeners() {
    this.strategyManager
      ?.on(STRATEGY_WARMUP_COMPLETED_EVENT, this.relayStrategyWarmupCompleted)
      .on(STRATEGY_CREATE_ORDER_EVENT, this.relayCreateOrder)
      .on(STRATEGY_CANCEL_ORDER_EVENT, this.relayCancelOrder)
      .on(STRATEGY_INFO_EVENT, this.relayStrategyInfo);
  }

  /* -------------------------------------------------------------------------- */
  /*                           EVENTS EMITERS                                   */
  /* -------------------------------------------------------------------------- */

  private relayStrategyWarmupCompleted(event: unknown) {
    this.addDeferredEmit(STRATEGY_WARMUP_COMPLETED_EVENT, event);
  }

  private relayCancelOrder(orderId: UUID) {
    if (!this.candle) throw new GekkoError('trading advisor', 'No candle when relaying advice');
    this.addDeferredEmit(STRATEGY_CANCEL_ORDER_EVENT, orderId);
  }

  private relayCreateOrder(advice: AdviceOrder) {
    this.addDeferredEmit<AdviceOrder>(STRATEGY_CREATE_ORDER_EVENT, advice);
  }

  private relayStrategyInfo(strategyInfo: StrategyInfo) {
    this.addDeferredEmit(STRATEGY_INFO_EVENT, strategyInfo);
  }

  /* -------------------------------------------------------------------------- */
  /*                          EVENT LISTENERS                                   */
  /* -------------------------------------------------------------------------- */

  public async onOrderCompleted(payloads: OrderCompletedEvent[]) {
    // Parallel strategy: process all payloads concurrently
    await Promise.all(
      payloads.map(order => {
        this.strategyManager?.onOrderCompleted(order);
      }),
    );
  }

  public async onOrderCanceled(payloads: OrderCanceledEvent[]) {
    // Parallel strategy: process all payloads concurrently
    await Promise.all(
      payloads.map(order => {
        this.strategyManager?.onOrderCanceled(order);
      }),
    );
  }

  public async onOrderErrored(payloads: OrderErroredEvent[]) {
    // Parallel strategy: process all payloads concurrently
    await Promise.all(
      payloads.map(order => {
        this.strategyManager?.onOrderErrored(order);
      }),
    );
  }

  public onPortfolioChange(payloads: Portfolio[]) {
    // Latest strategy: only process the most recent payload
    const portfolio = payloads[payloads.length - 1];
    this.strategyManager?.setPortfolio(portfolio);
  }

  public onTimeframeCandle(payloads: Candle[]) {
    // Sequential strategy: process each payload in order
    for (const newCandle of payloads) {
      this.strategyManager?.onTimeFrameCandle(newCandle);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                         PLUGIN LIFECYCLE HOOKS                             */
  /* -------------------------------------------------------------------------- */

  protected async processInit() {
    await this.setUpStrategy();
    this.setUpListeners();
    this.strategyManager?.setMarketData(this.getExchange().getMarketData());
    const balance = await this.getExchange().fetchBalance();
    this.strategyManager?.setPortfolio(balance);
    info('trading advisor', `Using the strategy: ${this.strategyName}`);
  }

  protected processOneMinuteCandle(candle: Candle) {
    this.candle = candle;
    const newCandle = this.candleBatcher.addSmallCandle(candle);
    if (newCandle) this.addDeferredEmit(TIMEFRAME_CANDLE_EVENT, newCandle);
    this.strategyManager?.onOneMinuteCandle(candle);
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
