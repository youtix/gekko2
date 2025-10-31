import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TIMEFRAME_CANDLE_EVENT,
} from '@constants/event.const';
import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { GekkoError } from '@errors/gekko.error';
import { Advice } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { OrderCompleted, OrderErrored } from '@models/order.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Plugin } from '@plugins/plugin';
import { CandleBatcher } from '@services/core/batcher/candleBatcher/candleBatcher';
import { CandleSize } from '@services/core/batcher/candleBatcher/candleBatcher.types';
import { info } from '@services/logger';
import { StrategyManager } from '@strategies/strategyManager';
import { addMinutes } from 'date-fns';
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

  private relayStrategyWarmupCompleted(event: unknown) {
    this.deferredEmit(STRATEGY_WARMUP_COMPLETED_EVENT, event);
  }

  private relayCancelOrder(orderId: UUID) {
    if (!this.candle) throw new GekkoError('trading advisor', 'No candle when relaying advice');
    this.deferredEmit(STRATEGY_CANCEL_ORDER_EVENT, orderId);
  }

  private relayCreateOrder(advice: Advice) {
    if (!this.candle) throw new GekkoError('trading advisor', 'No candle when relaying advice');
    this.deferredEmit(STRATEGY_CREATE_ORDER_EVENT, {
      ...advice,
      date: addMinutes(this.candle.start, 1).getTime(),
    });
  }

  private relayStrategyInfo(strategyInfo: StrategyInfo) {
    this.deferredEmit(STRATEGY_INFO_EVENT, strategyInfo);
  }
  // --- END INTERNALS ---

  // --------------------------------------------------------------------------
  //                           PLUGIN LISTENERS
  // --------------------------------------------------------------------------

  public onOrderCompleted(order: OrderCompleted) {
    this.strategyManager?.onOrderCompleted(order);
  }

  public onOrderErrored(order: OrderErrored) {
    this.strategyManager?.onOrderErrored(order);
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected async processInit() {
    await this.setUpStrategy();
    this.setUpListeners();
    info('trading advisor', `Using the strategy: ${this.strategyName}`);
  }

  protected processOneMinuteCandle(candle: Candle) {
    this.candle = candle;
    const newCandle = this.candleBatcher.addSmallCandle(candle);
    if (newCandle) {
      this.deferredEmit(TIMEFRAME_CANDLE_EVENT, newCandle);
      this.strategyManager?.onNewCandle(newCandle);
    }
  }

  protected processFinalize() {
    this.strategyManager?.finish();
  }

  public static getStaticConfiguration() {
    return {
      name: 'TradingAdvisor',
      schema: tradingAdvisorSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(TradingAdvisor.prototype), p => p.startsWith('on')),
      eventsEmitted: [
        STRATEGY_INFO_EVENT,
        STRATEGY_CREATE_ORDER_EVENT,
        STRATEGY_CANCEL_ORDER_EVENT,
        STRATEGY_WARMUP_COMPLETED_EVENT,
        TIMEFRAME_CANDLE_EVENT,
      ],
    };
  }
}
