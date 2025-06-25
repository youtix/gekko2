import { IndicatorNotFoundError } from '@errors/indicator/indicatorNotFound.error';
import { StrategyAlreadyInitializedError } from '@errors/strategy/strategyAlreadyInitialized.error';
import * as indicators from '@indicators/index';
import { Indicator } from '@indicators/indicator';
import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { config } from '@services/configuration/configuration';
import { info } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { each, map } from 'lodash-es';
import EventEmitter from 'node:events';
import {
  STARTEGY_ADVICE_EVENT,
  STRATEGY_NOTIFICATION_EVENT,
  STRATEGY_UPDATE_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from '../plugins/plugin.const';
import { Direction, StrategyNames, StrategyParamaters } from './strategy.types';

export abstract class Strategy<T extends StrategyNames> extends EventEmitter {
  protected age: number;
  protected candle?: Candle;
  protected candleSize: number;
  protected currentDirection?: Direction;
  protected indicators: Indicator[];
  protected isStartegyInitialized: boolean;
  protected isWarmupCompleted: boolean;
  protected propogatedAdvices: number;
  protected requiredHistory: number;
  protected strategyName: string;
  protected strategySettings: StrategyParamaters<T>;

  constructor(strategyName: string, candleSize: number, requiredHistory = 0) {
    super();
    this.age = 0;
    this.candleSize = candleSize;
    this.indicators = [];
    this.isStartegyInitialized = false;
    this.isWarmupCompleted = false;
    this.propogatedAdvices = 0;
    this.requiredHistory = requiredHistory;
    this.strategyName = strategyName;
    this.strategySettings = config.getStrategy<StrategyParamaters<T>>();

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
    // Trigger strategy hook
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
    this.indicators.push(indicator);

    return indicator;
  }

  protected notify(content: string) {
    this.emit(STRATEGY_NOTIFICATION_EVENT, { content, date: new Date() });
  }

  protected advice(newDirection: Direction) {
    // If advice the same direction than before or candle is not known then ignore it
    if (newDirection === this.currentDirection || !this.candle) return;

    this.propogatedAdvices++;

    // Timestamp handled in trading advisor
    this.emit<Partial<Advice>>(STARTEGY_ADVICE_EVENT, {
      id: `advice-${this.propogatedAdvices}`,
      recommendation: newDirection,
    });

    this.currentDirection = newDirection;
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
    if (this.requiredHistory < this.age) {
      this.isWarmupCompleted = true;
      info('strategy', `Strategy warmup done ! Sending first candle (${toISOString(candle.start)}) to strategy`);
      this.emit(STRATEGY_WARMUP_COMPLETED_EVENT, candle);
    }
  }
}
