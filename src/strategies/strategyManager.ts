import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import * as indicators from '@indicators/index';
import { Indicator } from '@indicators/indicator';
import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { AdviceOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Asset, Nullable, Pair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { MarketData } from '@services/exchange/exchange.types';
import { debug, error, info, warning } from '@services/logger';
import * as strategies from '@strategies/index';
import { toISOString } from '@utils/date/date.utils';
import { addMinutes } from 'date-fns';
import { bindAll } from 'lodash-es';
import { randomUUID, UUID } from 'node:crypto';
import EventEmitter from 'node:events';
import { isAbsolute, resolve } from 'node:path';
import { Strategy, Tools } from './strategy.types';

export class StrategyManager extends EventEmitter {
  private age: number;
  private warmupPeriod: number;
  private indicators: Indicator[];
  private strategyParams: object;
  private pairs: Pair[];
  private marketData: Nullable<MarketData>;
  private portfolio: Portfolio;
  private strategy?: Strategy<object>;
  private indicatorsResults: unknown[] = [];
  private oneMinuteCandle: Nullable<Candle>;

  constructor(warmupPeriod: number) {
    super();
    this.warmupPeriod = warmupPeriod;
    this.age = 0;
    this.indicators = [];
    this.strategyParams = config.getStrategy() ?? {};
    const { symbol } = config.getWatch().pairs[0]; // TODO: support multiple pairs
    const [asset, currency] = symbol.split('/');
    this.pairs = [[asset, currency]];
    this.portfolio = new Map<Asset, BalanceDetail>();
    this.marketData = null;
    this.oneMinuteCandle = null;

    bindAll(this, [this.addIndicator.name, this.createOrder.name, this.cancelOrder.name, this.log.name]);
  }

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
  }

  /* -------------------------------------------------------------------------- */
  /*                            EVENT LISTENERS                                 */
  /* -------------------------------------------------------------------------- */

  public onOneMinuteCandle(candle: Candle) {
    this.oneMinuteCandle = candle;
  }

  public onTimeFrameCandle(candle: Candle) {
    const tools = this.createTools();
    const params = { candle, portfolio: this.portfolio, tools };

    // Initialize strategy with time frame candle (do not use one minute candle)
    if (this.age === 0) this.strategy?.init({ ...params, addIndicator: this.addIndicator });

    // Update indicators
    this.indicatorsResults = this.indicators.map(indicator => {
      indicator.onNewCandle(candle);
      return indicator.getResult();
    });
    // Call for each candle
    this.strategy?.onEachTimeframeCandle(params, ...this.indicatorsResults);

    // Fire the warm-up event only when the strategy has fully completed its warm-up phase.
    if (this.warmupPeriod === this.age) this.emitWarmupCompletedEvent(candle);

    // Call log and onCandleAfterWarmup only after warm up is done
    if (this.warmupPeriod <= this.age) {
      this.strategy?.log(params, ...this.indicatorsResults);
      this.strategy?.onTimeframeCandleAfterWarmup(params, ...this.indicatorsResults);
    }

    // Increment age only if init function is not called or if warmup phase is not done.
    if (this.warmupPeriod >= this.age) this.age++;
  }

  public onOrderCompleted({ order, exchange }: OrderCompletedEvent) {
    this.strategy?.onOrderCompleted({ order, exchange, tools: this.createTools() }, ...this.indicatorsResults);
  }

  public onOrderCanceled({ order, exchange }: OrderCanceledEvent) {
    this.strategy?.onOrderCanceled({ order, exchange, tools: this.createTools() }, ...this.indicatorsResults);
  }

  public onOrderErrored({ order, exchange }: OrderErroredEvent) {
    this.strategy?.onOrderErrored({ order, exchange, tools: this.createTools() }, ...this.indicatorsResults);
  }

  public onStrategyEnd() {
    this.strategy?.end();
  }

  /* -------------------------------------------------------------------------- */
  /*                                  SETTERS                                   */
  /* -------------------------------------------------------------------------- */

  public setPortfolio(portfolio: Portfolio) {
    this.portfolio = portfolio;
  }

  public setMarketData(marketData: Nullable<MarketData>) {
    this.marketData = marketData;
  }

  /* -------------------------------------------------------------------------- */
  /*                  FUNCTIONS USED IN TRADER STRATEGIES                       */
  /* -------------------------------------------------------------------------- */

  private addIndicator<T extends IndicatorNames>(name: T, parameters: IndicatorParamaters<T>) {
    const Indicator = indicators[name];
    if (!Indicator) throw new GekkoError('strategy', `${name} indicator not found.`);

    // @ts-expect-error TODO fix complex typescript error
    const indicator = new Indicator(parameters);
    this.indicators.push(indicator);

    return indicator;
  }

  private cancelOrder(orderId: UUID): void {
    this.emit<UUID>(STRATEGY_CANCEL_ORDER_EVENT, orderId);
  }

  private createOrder(order: Omit<AdviceOrder, 'id' | 'orderCreationDate'>): UUID {
    if (!this.oneMinuteCandle) throw new GekkoError('strategy', 'No candle when relaying advice');
    const id = randomUUID();
    const orderCreationDate = addMinutes(this.oneMinuteCandle.start, 1).getTime();
    this.emit<AdviceOrder>(STRATEGY_CREATE_ORDER_EVENT, { ...order, id, orderCreationDate });
    return id;
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
        throw new GekkoError('strategy', message);
    }
    this.emit<StrategyInfo>(STRATEGY_INFO_EVENT, {
      timestamp: Date.now(),
      level,
      tag: 'strategy',
      message,
    });
  }

  /* -------------------------------------------------------------------------- */
  /*                            UTILS FUNCTIONS                                 */
  /* -------------------------------------------------------------------------- */

  private emitWarmupCompletedEvent(candle: Candle) {
    info('strategy', `Strategy warmup done ! Sending first candle (${toISOString(candle.start)}) to strategy`);
    this.emit(STRATEGY_WARMUP_COMPLETED_EVENT, candle);
  }

  private createTools(): Tools<object> {
    if (!this.marketData) throw new GekkoError('strategy', 'Market data are not defined building strategy tools');
    return {
      createOrder: this.createOrder,
      cancelOrder: this.cancelOrder,
      log: this.log,
      strategyParams: this.strategyParams,
      marketData: this.marketData,
      pairs: this.pairs,
    };
  }
}
