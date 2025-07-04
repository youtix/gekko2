import { GekkoError } from '@errors/gekko.error';
import * as indicators from '@indicators/index';
import { Indicator } from '@indicators/indicator';
import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { config } from '@services/configuration/configuration';
import { debug, error, info, warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { bindAll } from 'lodash-es';
import EventEmitter from 'node:events';
import { STRATEGY_ADVICE_EVENT, STRATEGY_WARMUP_COMPLETED_EVENT } from '../plugins/plugin.const';
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

    bindAll(this, [this.addIndicator.name, this.advice.name]);
  }

  // ---- Called by trading advisor ----
  public async createStrategy(strategyPath: string, strategyName: string) {
    const SelectedStrategy = (await import(strategyPath))[strategyName];
    if (!SelectedStrategy)
      throw new GekkoError('trading advisor', `Cannot find ${strategyName} strategy in ${strategyPath}`);
    this.strategy = new SelectedStrategy();
    this.strategy?.init(this.addIndicator, this.strategyParams);
    this.isStartegyInitialized = true;
  }

  public onNewCandle(candle: Candle) {
    const results = this.indicators.map(indicator => {
      indicator.onNewCandle(candle);
      return indicator.getResult();
    });
    const tools = { candle, advice: this.advice, debug, info, warning, error, strategyParams: this.strategyParams };
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
