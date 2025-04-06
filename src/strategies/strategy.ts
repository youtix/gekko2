import { IndicatorNotFoundError } from '@errors/indicator/indicatorNotFound.error';
import { StrategyAlreadyInitializedError } from '@errors/strategy/strategyAlreadyInitialized.error';
import * as indicators from '@indicators/index';
import { Indicator } from '@indicators/indicator';
import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { config } from '@services/configuration/configuration';
import { warning } from '@services/logger';
import { processStartTime } from '@utils/process/process.utils';
import Big from 'big.js';
import { isBefore, subMinutes } from 'date-fns';
import { each, isNil, isObject, isString, map } from 'lodash-es';
import EventEmitter from 'node:events';
import {
  STRATEGY_NOTIFICATION_EVENT,
  STRATEGY_UPDATE_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from '../plugins/tradingAdvisor/tradingAdvisor.const';
import { Direction, RecommendedAdvice, StrategyNames, StrategyParamaters } from './strategy.types';

export abstract class Strategy<T extends StrategyNames> extends EventEmitter {
  protected strategyName: string;
  protected strategySettings: StrategyParamaters<T>;
  protected indicators: Indicator[];
  protected isStartegyInitialized: boolean;
  protected age: number;
  protected candle?: Candle;
  protected requiredHistory?: number;
  protected candleSize: number;
  protected isWarmupCompleted: boolean;

  protected pendingTriggerAdvice?: string;
  protected currentDirection?: Direction;
  protected propogatedAdvices: number;

  constructor(strategyName: string, candleSize: number, requiredHistory?: number) {
    super();
    this.strategyName = strategyName;
    this.strategySettings = config.getStrategy<StrategyParamaters<T>>();
    this.candleSize = candleSize;
    this.indicators = [];
    this.isStartegyInitialized = false;
    this.age = 0;
    this.propogatedAdvices = 0;
    this.requiredHistory = requiredHistory;
    this.isWarmupCompleted = false;

    // Initialize user strategy
    this.init();
    this.isStartegyInitialized = true;
  }

  // ---- Called by trading advisor ----
  public onNewCandle(candle: Candle) {
    this.candle = candle;
    each(this.indicators, indicator => {
      indicator.onNewCandle(candle);
    });
    this.onEachCandle(candle);
    if (!this.isWarmupCompleted) this.warmup(candle);
    if (this.isWarmupCompleted) {
      this.log(candle);
      this.onCandleAfterWarmup(candle);
    }
    this.emit(STRATEGY_UPDATE_EVENT, {
      date: candle.start,
      indicators: map(this.indicators, indicator => ({
        [indicator.getName()]: indicator.getResult(),
      })),
    });
  }

  public onTradeCompleted(trade: TradeCompleted) {
    if (this.pendingTriggerAdvice && trade.action === 'sell' && this.pendingTriggerAdvice === trade.adviceId) {
      // This trade came from a trigger of the previous advice,
      // update stored direction
      this.currentDirection = 'short';
      this.pendingTriggerAdvice = undefined;
    }

    this.onTradeExecuted(trade);
  }

  public finish() {
    this.end();
  }
  // -------------------------------

  // ---- User startegy tools functions ----
  protected addIndicator<T extends IndicatorNames>(name: T, parameters: IndicatorParamaters<T>) {
    if (this.isStartegyInitialized) throw new StrategyAlreadyInitializedError(name);

    const Indicator = indicators[name];
    if (!Indicator) throw new IndicatorNotFoundError(name);

    // @ts-expect-error TODO fix complex typescript error
    const indicator = new Indicator(parameters);
    this.indicators = [...this.indicators, indicator];

    return indicator;
  }

  protected notify(content: string) {
    this.emit(STRATEGY_NOTIFICATION_EVENT, { content, date: new Date() });
  }

  protected advice(direction: RecommendedAdvice) {
    // Checks
    const newDirection = isString(direction) ? direction : direction.direction;
    if (newDirection === this.currentDirection || !this.candle) return;

    this.pendingTriggerAdvice = undefined;
    this.propogatedAdvices++;
    const advice: Partial<Advice> = {
      id: `advice-${this.propogatedAdvices}`,
      recommendation: newDirection,
    };

    if (isObject(direction)) {
      if (newDirection === 'short') {
        warning('strategy', 'Strategy adviced a stop on not long, this is not supported. As such the stop is ignored');
      }
      if (newDirection === 'long') {
        const { trailPercentage, trailValue } = direction.trigger;
        advice.trigger = {
          ...direction.trigger,
          ...(trailPercentage && !trailValue && { trailValue: +Big(trailPercentage).div(100).mul(this.candle.close) }),
        };
        this.pendingTriggerAdvice = `advice-${this.propogatedAdvices}`;
      }
    }

    this.currentDirection = newDirection;
    this.emit('advice', advice);
    return this.propogatedAdvices;
  }
  // -------------------------------

  // ---- User startegy API ----
  protected abstract init(): void;
  protected abstract onEachCandle(candle: Candle): void;
  protected abstract onCandleAfterWarmup(candle: Candle): void;
  protected abstract onTradeExecuted(trade: TradeCompleted): void;
  protected abstract log(candle: Candle): void;
  protected abstract end(): void;
  // -------------------------------

  private warmup(candle: Candle) {
    this.age++;
    // In live mode we might receive more candles than minimally needed.
    // In that case, check whether candle start time is > startTime
    const isPremature =
      config.getWatch().mode === 'realtime' && isBefore(candle.start, subMinutes(processStartTime(), this.candleSize));

    if (!isNil(this.requiredHistory) && this.requiredHistory <= this.age && !isPremature) {
      this.isWarmupCompleted = true;
      this.emit(STRATEGY_WARMUP_COMPLETED_EVENT, { start: candle.start });
    }
  }
}
