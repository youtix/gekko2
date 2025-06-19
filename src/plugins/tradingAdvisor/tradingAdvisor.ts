import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { PluginError } from '@errors/plugin/plugin.error';
import { StrategyNotFoundError } from '@errors/strategy/strategyNotFound.error';
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { Plugin } from '@plugins/plugin';
import { CandleBatcher } from '@services/core/batcher/candleBatcher/candleBatcher';
import { info } from '@services/logger';
import * as strategies from '@strategies/index';
import { Strategy } from '@strategies/strategy';
import { StrategyNames } from '@strategies/strategy.types';
import { addMinutes } from 'date-fns';
import { bindAll, filter } from 'lodash-es';
import {
  ADVICE_EVENT,
  STRATEGY_CANDLE_EVENT,
  STRATEGY_NOTIFICATION_EVENT,
  STRATEGY_UPDATE_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from './tradingAdvisor.const';
import { tradingAdvisorSchema } from './tradingAdvisor.schema';
import { TradingAdvisorConfiguration } from './tradingAdvisor.types';

export class TradingAdvisor extends Plugin {
  candle?: Candle;
  candleBatcher: CandleBatcher;
  strategy?: Strategy<StrategyNames>;

  constructor({ strategyName, windowMode }: TradingAdvisorConfiguration) {
    super(TradingAdvisor.name);
    this.candleBatcher = new CandleBatcher(TIMEFRAME_TO_MINUTES[this.timeframe], windowMode);

    const relayers = filter(Object.getOwnPropertyNames(TradingAdvisor.prototype), p => p.startsWith('relay'));
    bindAll(this, [...relayers]);

    this.setUpStrategy(strategyName, TIMEFRAME_TO_MINUTES[this.timeframe], this.warmupPeriod);
    this.setUpListeners();
    info('trading advisor', `Using the strategy: ${strategyName}`);
  }

  // --- BEGIN LISTENERS ---
  public onTradeCompleted(trade: TradeCompleted) {
    this.strategy?.onTradeCompleted(trade);
  }
  // --- END LISTENERS ---

  // --- BEGIN INTERNALS ---
  private setUpStrategy(strategyName: string, candleSize: number, historySize: number) {
    const SelectedStrategy = strategies[strategyName as keyof typeof strategies];
    if (!SelectedStrategy) throw new StrategyNotFoundError(strategyName);
    this.strategy = new SelectedStrategy(strategyName, candleSize, historySize);
  }

  private setUpListeners() {
    this.strategy
      ?.on(STRATEGY_WARMUP_COMPLETED_EVENT, this.relayStrategyWarmupCompleted)
      .on(ADVICE_EVENT, this.relayAdvice)
      .on(STRATEGY_UPDATE_EVENT, this.relayStrategyUpdate)
      .on(STRATEGY_NOTIFICATION_EVENT, this.relayStrategyNotification);
  }

  private relayStrategyWarmupCompleted(event: unknown) {
    this.deferredEmit(STRATEGY_WARMUP_COMPLETED_EVENT, event);
  }

  private relayStrategyUpdate(event: unknown) {
    this.deferredEmit(STRATEGY_UPDATE_EVENT, event);
  }

  private relayStrategyNotification(event: unknown) {
    this.deferredEmit(STRATEGY_NOTIFICATION_EVENT, event);
  }

  private relayAdvice(advice: Advice) {
    if (!this.candle) throw new PluginError(this.pluginName, 'No candle when relaying advice');
    this.deferredEmit(ADVICE_EVENT, {
      ...advice,
      date: addMinutes(this.candle.start, 1).getTime(),
    });
  }
  // --- END INTERNALS ---

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected processCandle(candle: Candle) {
    this.candle = candle;
    const newCandle = this.candleBatcher.addSmallCandle(candle);
    if (newCandle) {
      this.deferredEmit(STRATEGY_CANDLE_EVENT, newCandle);
      this.strategy?.onNewCandle(newCandle);
    }
  }

  protected processFinalize() {
    this.strategy?.finish();
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
        ADVICE_EVENT,
        STRATEGY_CANDLE_EVENT,
        STRATEGY_NOTIFICATION_EVENT,
        STRATEGY_UPDATE_EVENT,
        STRATEGY_WARMUP_COMPLETED_EVENT,
      ],
    };
  }
}
