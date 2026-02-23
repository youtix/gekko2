import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TRAILING_STOP_ACTIVATED,
  TRAILING_STOP_TRIGGERED,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import * as indicators from '@indicators/index';
import { Indicator } from '@indicators/indicator';
import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { AdviceOrder, StrategyOrder, TrailingConfig } from '@models/advice.types';
import { CandleBucket, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Asset, TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { MarketData } from '@services/exchange/exchange.types';
import { debug, error, info, warning } from '@services/logger';
import * as strategies from '@strategies/index';
import { toISOString } from '@utils/date/date.utils';
import { addMinutes } from 'date-fns';
import { bindAll, omit } from 'lodash-es';
import { randomUUID, UUID } from 'node:crypto';
import EventEmitter from 'node:events';
import { isAbsolute, resolve } from 'node:path';
import { Strategy, Tools } from './strategy.types';
import { TrailingStopManager } from './trailingStopManager';
import { TrailingStopState } from './trailingStopManager.types';

export class StrategyManager extends EventEmitter {
  private age: number;
  private warmupPeriod: number;
  private indicators: { indicator: Indicator; symbol: TradingPair }[];
  private strategyParams: object;
  private marketData: Map<TradingPair, MarketData>;
  private portfolio: Portfolio;
  private strategy?: Strategy<object>;
  private indicatorsResults: unknown[] = [];
  private currentTimestamp: EpochTimeStamp = 0;
  private trailingStopManager: TrailingStopManager;
  private pendingTrailingStops: Map<UUID, TrailingConfig>;

  constructor(warmupPeriod: number) {
    super();
    this.warmupPeriod = warmupPeriod;
    this.age = 0;
    this.indicators = [];
    this.strategyParams = config.getStrategy() ?? {};
    this.portfolio = new Map<Asset, BalanceDetail>();
    this.marketData = new Map();
    this.pendingTrailingStops = new Map();
    this.trailingStopManager = new TrailingStopManager();

    bindAll(this, [
      this.addIndicator.name,
      this.createOrder.name,
      this.cancelOrder.name,
      this.log.name,
      this.onTrailingStopActivated.name,
      this.onTrailingStopTriggered.name,
    ]);

    this.trailingStopManager.on(TRAILING_STOP_TRIGGERED, this.onTrailingStopTriggered);
    this.trailingStopManager.on(TRAILING_STOP_ACTIVATED, this.onTrailingStopActivated);
  }

  public async createStrategy(strategyName: string, strategyPath?: string) {
    if (strategyPath) {
      const resolvedPath = isAbsolute(strategyPath) ? strategyPath : resolve(process.cwd(), strategyPath);
      const SelectedStrategy = (await import(resolvedPath))[strategyName];
      if (!SelectedStrategy) throw new GekkoError('trading advisor', `Cannot find external ${strategyName} strategy in ${resolvedPath}`);
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

  public onOneMinuteBucket(bucket: CandleBucket) {
    // Update current timestamp with the latest candle data
    const firstCandle = bucket.values().next().value;
    if (firstCandle) this.currentTimestamp = firstCandle.start;
    // Update trailing stop orders each minute with the latest candle data
    this.trailingStopManager.update(bucket);
  }

  public onTimeFrameCandle(bucket: CandleBucket) {
    const tools = this.createTools();
    const params = { candle: bucket, portfolio: this.portfolio, tools };

    // Initialize strategy with time frame candle (do not use one minute candle)
    if (this.age === 0) this.strategy?.init?.({ ...params, addIndicator: this.addIndicator });

    // Update indicators
    this.indicatorsResults = this.indicators.map(({ indicator, symbol }) => {
      const candle = bucket.get(symbol);
      if (candle) indicator.onNewCandle(candle);
      else warning('strategy', `Candle for ${symbol} not found in strategy manager`);
      return indicator.getResult();
    });
    // Call for each candle
    this.strategy?.onEachTimeframeCandle?.(params, ...this.indicatorsResults);

    // Fire the warm-up event only when the strategy has fully completed its warm-up phase.
    if (this.warmupPeriod === this.age) this.emitWarmupCompletedEvent(bucket);

    // Call log and onCandleAfterWarmup only after warm up is done
    if (this.warmupPeriod <= this.age) {
      this.strategy?.log?.(params, ...this.indicatorsResults);
      this.strategy?.onTimeframeCandleAfterWarmup?.(params, ...this.indicatorsResults);
    }

    // Increment age only if init function is not called or if warmup phase is not done.
    if (this.warmupPeriod >= this.age) this.age++;
  }

  public onOrderCompleted({ order, exchange }: OrderCompletedEvent) {
    this.strategy?.onOrderCompleted?.({ order, exchange, tools: this.createTools() }, ...this.indicatorsResults);

    if (this.pendingTrailingStops.has(order.id)) {
      this.trailingStopManager.addOrder({
        id: order.id,
        symbol: order.symbol,
        side: order.side === 'BUY' ? 'SELL' : 'BUY',
        amount: order.amount,
        trailing: this.pendingTrailingStops.get(order.id),
        createdAt: order.orderCreationDate,
      });
      this.pendingTrailingStops.delete(order.id);
    }
  }

  public onOrderCanceled({ order, exchange }: OrderCanceledEvent) {
    this.strategy?.onOrderCanceled?.({ order, exchange, tools: this.createTools() }, ...this.indicatorsResults);
    this.pendingTrailingStops.delete(order.id);
    this.trailingStopManager.removeOrder(order.id);
  }

  public onOrderErrored({ order, exchange }: OrderErroredEvent) {
    this.strategy?.onOrderErrored?.({ order, exchange, tools: this.createTools() }, ...this.indicatorsResults);
    this.pendingTrailingStops.delete(order.id);
    this.trailingStopManager.removeOrder(order.id);
  }

  public onStrategyEnd() {
    const pendingOrders = this.trailingStopManager.getOrders();
    if (pendingOrders.size > 0)
      warning('strategy', `Strategy ended with ${pendingOrders.size} active trailing stop(s) that never triggered.`);
    this.trailingStopManager.removeAllListeners();
    this.strategy?.end?.();
  }

  private onTrailingStopActivated(state: TrailingStopState) {
    this.strategy?.onTrailingStopActivated?.(state);
  }

  private onTrailingStopTriggered(state: TrailingStopState) {
    const orderId = this.createOrder({ symbol: state.symbol, side: state.side, type: 'MARKET', amount: state.amount });
    this.strategy?.onTrailingStopTriggered?.(orderId, state);
  }

  /* -------------------------------------------------------------------------- */
  /*                                  SETTERS                                   */
  /* -------------------------------------------------------------------------- */

  public setPortfolio(portfolio: Portfolio) {
    this.portfolio = portfolio;
  }

  public setMarketData(marketData: Map<TradingPair, MarketData>) {
    this.marketData = marketData;
  }

  /* -------------------------------------------------------------------------- */
  /*                  FUNCTIONS USED IN TRADER STRATEGIES                       */
  /* -------------------------------------------------------------------------- */

  private addIndicator<T extends IndicatorNames>(name: T, symbol: TradingPair, parameters: IndicatorParamaters<T>) {
    const Indicator = indicators[name];
    if (!Indicator) throw new GekkoError('strategy', `${name} indicator not found.`);

    // @ts-expect-error TODO fix complex typescript error
    const indicator = new Indicator(parameters);
    this.indicators.push({ indicator, symbol });

    return indicator;
  }

  private cancelOrder(orderId: UUID): void {
    this.emit<UUID>(STRATEGY_CANCEL_ORDER_EVENT, orderId);
  }

  private createOrder(order: StrategyOrder): UUID {
    if (!this.currentTimestamp) throw new GekkoError('strategy', 'No candle when relaying advice');
    const id = randomUUID();
    const orderCreationDate = addMinutes(this.currentTimestamp, 1).getTime();

    // If it is a trailing stop order, add it to the waiting list, it will be created after order completion
    if (order.trailing) this.pendingTrailingStops.set(id, order.trailing);

    this.emit<AdviceOrder>(STRATEGY_CREATE_ORDER_EVENT, { ...omit(order, 'trailing'), id, orderCreationDate });
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
    this.emit<StrategyInfo>(STRATEGY_INFO_EVENT, { timestamp: this.currentTimestamp, level, tag: 'strategy', message });
  }

  /* -------------------------------------------------------------------------- */
  /*                            UTILS FUNCTIONS                                 */
  /* -------------------------------------------------------------------------- */

  private emitWarmupCompletedEvent(bucket: CandleBucket) {
    // Use first available candle for logging timestamp
    const firstCandle = bucket.values().next().value;
    info('strategy', `Strategy warmup done ! Sending first candle bucket (${toISOString(firstCandle?.start)}) to strategy`);
    this.emit<CandleBucket>(STRATEGY_WARMUP_COMPLETED_EVENT, bucket);
  }

  private createTools(): Tools<object> {
    return {
      createOrder: this.createOrder,
      cancelOrder: this.cancelOrder,
      log: this.log,
      strategyParams: this.strategyParams,
      marketData: this.marketData,
    };
  }
}
