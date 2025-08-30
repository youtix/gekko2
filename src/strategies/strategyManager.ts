import { STRATEGY_ADVICE_EVENT, STRATEGY_INFO_EVENT, STRATEGY_WARMUP_COMPLETED_EVENT } from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import * as indicators from '@indicators/index';
import { Indicator } from '@indicators/indicator';
import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { Advice } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { LogLevel } from '@models/logLevel.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { TradeCompleted } from '@models/tradeStatus.types';
import { config } from '@services/configuration/configuration';
import { debug, error, info, warning } from '@services/logger';
import * as strategies from '@strategies/index';
import { toISOString } from '@utils/date/date.utils';
import { bindAll } from 'lodash-es';
import EventEmitter from 'node:events';
import { isAbsolute, resolve } from 'node:path';
import { Direction, Strategy } from './strategy.types';

export class StrategyManager extends EventEmitter {
  private age: number;
  private warmupPeriod: number;
  private currentDirection?: Direction;
  private indicators: Indicator[];
  private isStartegyInitialized: boolean;
  private isWarmupCompleted: boolean;
  private propogatedAdvices: number;
  private strategyParams: object;
  private strategy?: Strategy<object>;

  constructor(warmupPeriod: number) {
    super();
    this.isStartegyInitialized = false;
    this.warmupPeriod = warmupPeriod;
    this.age = 0;
    this.indicators = [];
    this.isStartegyInitialized = false;
    this.isWarmupCompleted = false;
    this.propogatedAdvices = 0;
    this.strategyParams = config.getStrategy();

    bindAll(this, [this.addIndicator.name, this.advice.name, this.log.name]);
  }

  // ---- Called by trading advisor ----
  public async createStrategy(strategyName: string, strategyPath?: string) {
    if (strategyPath) {
      const resolvedPath = isAbsolute(strategyPath) ? strategyPath : resolve(process.cwd(), strategyPath);
      const SelectedStrategy = (await import(resolvedPath))[strategyName];
      if (!SelectedStrategy)
        throw new GekkoError('trading advisor', `Cannot find external ${strategyName} strategy in ${resolvedPath}`);
      this.strategy = new SelectedStrategy();
    } else {
      const SelectedStrategy = strategies[strategyName as keyof typeof strategies];
      if (!SelectedStrategy) throw new GekkoError('trading advisor', `Cannot find internal ${strategyName} strategy`);
      this.strategy = new SelectedStrategy();
    }
    this.strategy?.init(this.addIndicator, this.strategyParams);
    this.isStartegyInitialized = true;
  }

  public onNewCandle(candle: Candle) {
    const results = this.indicators.map(indicator => {
      indicator.onNewCandle(candle);
      return indicator.getResult();
    });
    const tools = { candle, advice: this.advice, log: this.log, strategyParams: this.strategyParams };
    this.strategy?.onEachCandle(tools, ...results);
    if (!this.isWarmupCompleted) this.warmup(candle);
    if (this.isWarmupCompleted) {
      this.strategy?.log(tools, ...results);
      this.strategy?.onCandleAfterWarmup(tools, ...results);
    }
  }

  public onTradeCompleted(trade: TradeCompleted) {
    this.strategy?.onTradeCompleted(trade);
  }

  public finish() {
    this.strategy?.end();
  }
  // -------------------------------

  // ---- User startegy tools functions ----
  private addIndicator<T extends IndicatorNames>(name: T, parameters: IndicatorParamaters<T>) {
    if (this.isStartegyInitialized)
      throw new GekkoError('strategy', `Can only add indicators (${name}) in init function of the strategy.`);

    const Indicator = indicators[name];
    if (!Indicator) throw new GekkoError('strategy', `${name} indicator not found.`);

    // @ts-expect-error TODO fix complex typescript error
    const indicator = new Indicator(parameters);
    this.indicators.push(indicator);

    return indicator;
  }

  private advice(newDirection: Direction) {
    // If advice the same direction than before then ignore it
    if (newDirection === this.currentDirection) return;

    this.propogatedAdvices++;

    // Timestamp handled in trading advisor
    this.emit<Partial<Advice>>(STRATEGY_ADVICE_EVENT, {
      id: `advice-${this.propogatedAdvices}`,
      recommendation: newDirection,
    });

    this.currentDirection = newDirection;
    return this.propogatedAdvices;
  }

  private log(level: LogLevel, message: string) {
    switch (level) {
      case 'debug':
        debug('strategy', message);
        break;
      case 'info':
        info('strategy', message);
        break;
      case 'warn':
        warning('strategy', message);
        break;
      case 'error':
        error('strategy', message);
        break;
    }
    this.emit<StrategyInfo>(STRATEGY_INFO_EVENT, {
      timestamp: Date.now(),
      level,
      tag: 'strategy',
      message,
    });
  }
  // -------------------------------

  private warmup(candle: Candle) {
    this.age++;
    if (this.warmupPeriod < this.age) {
      this.isWarmupCompleted = true;
      info('strategy', `Strategy warmup done ! Sending first candle (${toISOString(candle.start)}) to strategy`);
      this.emit(STRATEGY_WARMUP_COMPLETED_EVENT, candle);
    }
  }
}
