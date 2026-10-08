import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TRAILING_STOP_ACTIVATED,
  TRAILING_STOP_TRIGGERED,
} from '@constants/event.const';
import { ApplicationStopError } from '@errors/applicationStop.error';
import { GekkoError } from '@errors/gekko.error';
import * as indicators from '@indicators/index';
import { Indicator } from '@indicators/indicator';
import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { AdviceOrder, StrategyOrder, TrailingConfig } from '@models/advice.types';
import { CandleBucket, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent, OrderInitiatedEvent } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Asset, TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { MarketData } from '@services/exchange/exchange.types';
import { debug, error, info, warning } from '@services/logger';
import * as strategies from '@strategies/index';
import { getFirstCandleFromBucket } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { isFiniteNumber } from '@utils/math/math.utils';
import { addMinutes } from 'date-fns';
import { bindAll, isNil, omit } from 'lodash-es';
import { randomUUID, UUID } from 'node:crypto';
import EventEmitter from 'node:events';
import { isAbsolute, resolve } from 'node:path';
import { inspect } from 'node:util';
import { z } from 'zod';
import { IndicatorResults, Strategy, StrategyConstructor, Tools } from './strategy.types';
import { TrailingStopManager } from './trailingStopManager';
import { TrailingStopState } from './trailingStopManager.types';

/**
 * What is wrong with the trailing stop an order asks for, or undefined when it asks for none or for a valid one: on a BUY only, within
 * the bounds the TrailingStopManager checks again as it arms the stop. A trigger left out (undefined, or null from an untyped strategy)
 * asks for a stop active as soon as it is armed.
 */
const getTrailingProblem = ({ side, trailing }: StrategyOrder): string | undefined => {
  if (!trailing) return;
  if (side !== 'BUY') return 'trailing applies to BUY orders only: its stop sells what the BUY filled';
  const { percentage, trigger } = trailing;
  if (!(Number.isFinite(percentage) && percentage > 0 && percentage < 100))
    return `trailing.percentage must be a number above 0 and below 100 (2.5 for 2.5%), got ${inspect(percentage)}`;
  if (!isNil(trigger) && !(Number.isFinite(trigger) && trigger > 0))
    return `trailing.trigger must be a price above 0, or left out for a stop active as soon as its BUY completes, got ${inspect(trigger)}`;
};

export class StrategyManager extends EventEmitter {
  private readonly warmupPeriod: number;
  private readonly maxConsecutiveErrors: number;
  /** The strategy block, replaced by its parse when the strategy's class declares a schema; the same object as tools.strategyParams */
  private strategyParams: object;
  private readonly trailingStopManager: TrailingStopManager;

  private age = 0;
  /** Set as the warmup event is emitted, never reset: createOrder refuses orders until then */
  private isWarmupCompleted = false;
  private indicators: { indicator: Indicator; symbol: TradingPair }[] = [];
  private marketData = new Map<TradingPair, MarketData>();
  private portfolio = new Map<Asset, BalanceDetail>();
  private indicatorsResults: IndicatorResults[] = [];
  private currentTimestamp: EpochTimeStamp = 0;
  private pendingTrailingStops = new Map<UUID, TrailingConfig>();
  /** The SELLs the trailing stops sent, until their outcome: told apart from the SELLs the strategy created (see onOrderCompleted) */
  private readonly trailingStopSellIds = new Set<UUID>();
  private consecutiveErrors = 0;
  /** The levels outside LogLevel the strategy logged at, each reported once */
  private readonly unknownLogLevels = new Set<unknown>();
  private strategy?: Strategy<object>;
  private tools: Tools<object>;

  constructor(warmupPeriod: number, maxConsecutiveErrors: number = 5) {
    super();
    this.warmupPeriod = warmupPeriod;
    this.maxConsecutiveErrors = maxConsecutiveErrors;
    this.strategyParams = config.getStrategy() ?? {};
    this.trailingStopManager = new TrailingStopManager();

    bindAll(this, [
      this.addIndicator.name,
      this.createOrder.name,
      this.cancelOrder.name,
      this.cancelTrailingOrder.name,
      this.log.name,
      this.onTrailingStopActivated.name,
      this.onTrailingStopTriggered.name,
    ]);

    this.tools = {
      createOrder: this.createOrder,
      cancelOrder: this.cancelOrder,
      log: this.log,
      strategyParams: this.strategyParams,
      marketData: this.marketData,
      cancelTrailingOrder: this.cancelTrailingOrder,
    };

    this.trailingStopManager.on(TRAILING_STOP_TRIGGERED, this.onTrailingStopTriggered);
    this.trailingStopManager.on(TRAILING_STOP_ACTIVATED, this.onTrailingStopActivated);
  }

  public async createStrategy(strategyName: string, strategyPath?: string) {
    // Annotated, not cast: the compiler checks that every export of the registry is a strategy class whose schema, if any, is a zod
    // schema. The export of an external file is only known at run time.
    let SelectedStrategy: StrategyConstructor | undefined;
    if (strategyPath) {
      const resolvedPath = isAbsolute(strategyPath) ? strategyPath : resolve(process.cwd(), strategyPath);
      SelectedStrategy = (await import(resolvedPath))[strategyName];
      if (!SelectedStrategy) throw new GekkoError('trading advisor', `Cannot find external ${strategyName} strategy in ${resolvedPath}`);
    } else {
      SelectedStrategy = strategies[strategyName as keyof typeof strategies];
      if (!SelectedStrategy) throw new GekkoError('trading advisor', `Cannot find internal ${strategyName} strategy`);
    }
    this.parseStrategyParams(strategyName, SelectedStrategy);
    this.strategy = new SelectedStrategy();
  }

  /* -------------------------------------------------------------------------- */
  /*                            EVENT LISTENERS                                 */
  /* -------------------------------------------------------------------------- */

  public onOneMinuteBucket(bucket: CandleBucket) {
    // Update current timestamp with the latest candle data
    const firstCandle = getFirstCandleFromBucket(bucket);
    this.currentTimestamp = addMinutes(firstCandle.start, 1).getTime();
    // Update trailing stop orders each minute with the latest candle data
    this.trailingStopManager.update(bucket);
  }

  public onTimeFrameCandle(bucket: CandleBucket) {
    const params = { candle: bucket, portfolio: this.portfolio, tools: this.tools };

    // Initialize strategy with time frame candle (do not use one minute candle)
    if (this.age === 0) this.strategy?.init?.({ ...params, addIndicator: this.addIndicator });

    // Update indicators
    this.indicatorsResults = this.indicators.map<IndicatorResults>(({ indicator, symbol }) => {
      const candle = bucket.get(symbol);
      if (candle) indicator.onNewCandle(candle);
      else warning('strategy', `Candle for ${symbol} not found in strategy manager`);
      return { results: indicator.getResult(), symbol };
    });
    // Call for each candle
    this.strategy?.onEachTimeframeCandle?.(params, ...this.indicatorsResults);

    // Fire the warm-up event only when the strategy has fully completed its warm-up phase.
    if (this.warmupPeriod === this.age) this.emitWarmupCompletedEvent(bucket);

    // Call log and onCandleAfterWarmup only after warm up is done
    if (this.isWarmupCompleted) {
      this.strategy?.log?.(params, ...this.indicatorsResults);
      this.strategy?.onTimeframeCandleAfterWarmup?.(params, ...this.indicatorsResults);
    }

    // Increment age only if init function is not called or if warmup phase is not done.
    if (this.warmupPeriod >= this.age) this.age++;
  }

  public onOrderCompleted({ order, exchange }: OrderCompletedEvent) {
    this.consecutiveErrors = 0;
    this.strategy?.onOrderCompleted?.({ order, exchange, tools: this.tools }, ...this.indicatorsResults);

    this.armPendingTrailingStop(order, order.amount);

    // The SELL of a stop sold what its own BUY filled: that stop is over, and the other stops of the pair still protect theirs. A SELL
    // the strategy created closed the position the stops of its pair protected.
    const isTrailingStopSell = this.trailingStopSellIds.delete(order.id);
    if (isTrailingStopSell) this.trailingStopManager.removeSellingStop(order.id);
    else if (order.side === 'SELL') this.cancelTrailingStopsOfPair(order);
  }

  public onOrderCanceled({ order, exchange }: OrderCanceledEvent) {
    this.consecutiveErrors = 0;
    this.strategy?.onOrderCanceled?.({ order, exchange, tools: this.tools }, ...this.indicatorsResults);
    // A BUY canceled drops the stop it asked for, even after a partial fill
    this.cancelTrailingOrder(order.id);
    if (this.trailingStopSellIds.delete(order.id)) {
      // What it sold before it expired (a MARKET SELL fills what the book allows), or 0 when its cancelation was answered without the
      // fill: the stop then sells its whole amount again, which the Trader caps to what is free
      const sold = isFiniteNumber(order.filled) && order.filled > 0 ? order.filled : 0;
      this.resumeTrailingStop(order.id, 'was canceled', sold);
    }
  }

  public onOrderErrored({ order, exchange }: OrderErroredEvent) {
    this.consecutiveErrors++;
    const isConsecutiveErrorsReached = this.maxConsecutiveErrors !== -1 && this.consecutiveErrors >= this.maxConsecutiveErrors;
    // Thrown before the hook and the trailing clean-up, the breaker kept the error that trips it from the strategy, which ended holding
    // the order as pending
    try {
      this.strategy?.onOrderErrored?.({ order, exchange, tools: this.tools }, ...this.indicatorsResults);
    } catch (hookError) {
      if (!isConsecutiveErrorsReached) throw hookError;
      // The orderly stop prevails, as in PluginsStream: a restart-on-failure supervisor leaves the bot stopped
      const reason = hookError instanceof Error ? hookError.message : inspect(hookError);
      error('strategy', `The strategy's onOrderErrored failed on the error that trips the circuit breaker: ${reason}`);
    }
    // What the order executed before its error, as far as the exchange reported it
    const filled = isFiniteNumber(order.filled) && order.filled > 0 ? order.filled : 0;
    if (this.trailingStopSellIds.delete(order.id)) this.resumeTrailingStop(order.id, 'errored', filled, order.reason);
    else this.settleTrailingStopOfErroredBuy(order, filled);
    if (isConsecutiveErrorsReached) throw new ApplicationStopError(`Max consecutive order errors reached (${this.maxConsecutiveErrors})`);
  }

  public onStrategyEnd() {
    // A backtest too short for its warmup ended normally, without a trade, and only analyzer warnings that did not name the warmup.
    // The configuration refuses such a range, but a run can still stop before its warmup is over (on an error, or in realtime before
    // the first live timeframe candle).
    if (!this.isWarmupCompleted)
      error(
        'strategy',
        `Strategy ended before its warmup was over, so it never traded: ${this.age} timeframe candle(s) processed, ${this.warmupPeriod + 1} needed (warmup.candleCount: ${this.warmupPeriod}, then one to trade on)`,
      );
    const stops = [...this.trailingStopManager.getOrders().values()];
    const sellingCount = stops.filter(({ status }) => status === 'selling').length;
    const armedCount = stops.length - sellingCount;
    if (armedCount > 0) warning('strategy', `Strategy ended with ${armedCount} active trailing stop(s) that never triggered.`);
    if (sellingCount > 0) warning('strategy', `Strategy ended with ${sellingCount} triggered trailing stop(s) whose SELL had not ended.`);
    this.trailingStopManager.removeAllListeners();
    this.strategy?.end?.();
  }

  public onPortfolioChange(portfolio: Portfolio) {
    this.portfolio = portfolio;
  }

  // Given the state alone, the trailing hooks could neither cancel a stop, log nor order unless the strategy had kept the tools of an
  // earlier hook: they get them last, so that a hook written without them still fits
  private onTrailingStopActivated(state: TrailingStopState) {
    this.strategy?.onTrailingStopActivated?.(state, this.tools);
  }

  private onTrailingStopTriggered(state: TrailingStopState) {
    const orderId = this.createOrder({ symbol: state.symbol, side: 'SELL', type: 'MARKET', amount: state.amount });
    this.trailingStopSellIds.add(orderId);
    // The stop sells until that SELL ends (see onOrderCompleted and resumeTrailingStop): the hook gets it with the id of its SELL
    const selling = this.trailingStopManager.setSellOrderId(state.id, orderId) ?? state;
    this.strategy?.onTrailingStopTriggered?.(orderId, selling, this.tools);
  }

  /* -------------------------------------------------------------------------- */
  /*                                  SETTERS                                   */
  /* -------------------------------------------------------------------------- */

  public setMarketData(marketData: Map<TradingPair, MarketData>) {
    this.marketData = marketData;
    this.tools.marketData = marketData;
  }

  /* -------------------------------------------------------------------------- */
  /*                  FUNCTIONS USED IN TRADER STRATEGIES                       */
  /* -------------------------------------------------------------------------- */

  private addIndicator<T extends IndicatorNames>(name: T, symbol: TradingPair, parameters: IndicatorParamaters<T>): void {
    const Indicator = indicators[name];
    if (!Indicator) throw new GekkoError('strategy', `${name} indicator not found.`);

    // @ts-expect-error TODO fix complex typescript error
    const indicator = new Indicator(parameters);
    this.indicators.push({ indicator, symbol });
  }

  private cancelOrder(orderId: UUID): void {
    this.emit<UUID>(STRATEGY_CANCEL_ORDER_EVENT, orderId);
  }

  private cancelTrailingOrder(orderId: UUID): void {
    this.pendingTrailingStops.delete(orderId);
    this.trailingStopManager.removeOrder(orderId);
  }

  private createOrder(order: StrategyOrder): UUID {
    if (!this.currentTimestamp) throw new GekkoError('strategy', 'No candle when relaying advice');
    // In realtime the warmup candles are history, replayed with the Trader active: an order created on one of them went to the
    // exchange at once, priced or centred on a close that could be a year old (in backtest it traded on candles the reports leave out).
    // The warmup event comes before log and onTimeframeCandleAfterWarmup on the candle that completes the warmup (the first candle
    // when candleCount is 0): every order follows it, and none can come from init.
    if (!this.isWarmupCompleted)
      throw new GekkoError(
        'strategy',
        'Orders are not available until the warmup is over: create them from onTimeframeCandleAfterWarmup, log or an order hook, never from init',
      );
    this.checkOrder(order);
    const id = randomUUID();
    // The clock is already the end of the minute being processed, where the Trader and the simulated exchange date fills and errors:
    // a minute added to it dated every order after its own fill.
    const orderCreationDate = this.currentTimestamp;

    // The stop of a BUY (checkOrder refuses one on a SELL) is armed once the BUY completes. Kept by reference until then, it was the
    // strategy's object: a change made in between armed another stop than the one checked here, or none (a percentage of 0).
    if (order.trailing) this.pendingTrailingStops.set(id, { ...order.trailing });

    this.emit<AdviceOrder>(STRATEGY_CREATE_ORDER_EVENT, { ...omit(order, 'trailing'), id, orderCreationDate });
    return id;
  }

  private log(level: LogLevel, message: string) {
    let relayedLevel = level;
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
      default: {
        // Bun loads a strategyPath without type-checking it, and a JavaScript strategy has no types: a level outside LogLevel ('warning',
        // 'ERROR') logged nothing and was relayed as it was, to Telegram too. Reported once per level: a strategy logs on every candle.
        const unknownLevel: never = level;
        if (!this.unknownLogLevels.has(unknownLevel)) {
          this.unknownLogLevels.add(unknownLevel);
          warning(
            'strategy',
            `Unknown log level ${inspect(unknownLevel)} in tools.log: its messages are logged and relayed at info level (levels: debug, info, warn, error)`,
          );
        }
        info('strategy', message);
        relayedLevel = 'info';
      }
    }
    this.emit<StrategyInfo>(STRATEGY_INFO_EVENT, { timestamp: this.currentTimestamp, level: relayedLevel, tag: 'strategy', message });
    // Relayed before the throw, as every other line is: thrown first, an error line was never relayed, even when the strategy caught the
    // error and went on
    if (level === 'error') throw new GekkoError('strategy', message);
  }

  /* -------------------------------------------------------------------------- */
  /*                            UTILS FUNCTIONS                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * Checks the strategy block with the schema of the strategy's class, before the strategy exists. Unchecked, a misspelt or missing
   * parameter was silently undefined: an indicator fell back to its default period, a comparison with undefined never held, or the
   * strategy threw a TypeError once its indicators were ready, which can be hours into a realtime run.
   */
  private parseStrategyParams(strategyName: string, { schema }: StrategyConstructor) {
    if (!schema) {
      info('trading advisor', `Strategy ${strategyName} declares no schema: its parameters (the strategy block) are not validated`);
      return;
    }
    // Without name, which only labels the run and which the configuration schema checks: the strategy gets what the schema outputs
    const result = schema.safeParse(omit(this.strategyParams, 'name'));
    if (!result.success) {
      const issues = z.prettifyError(result.error);
      throw new GekkoError('trading advisor', `Invalid parameters for strategy ${strategyName} (strategy block):\n${issues}`);
    }
    this.strategyParams = result.data;
    this.tools.strategyParams = result.data;
  }

  /**
   * Refuses, before anything is relayed, an order the strategy cannot have meant. The trailing stop of a BUY was only checked once the
   * BUY had completed: an invalid one was refused then, with a warning, and the position the BUY had just opened kept no stop. One
   * given to a SELL was dropped without a word.
   */
  private checkOrder(order: StrategyOrder) {
    const problem = getTrailingProblem(order);
    if (!problem) return;
    const { side, type, symbol } = order;
    throw new GekkoError('strategy', `Impossible to create the ${side} ${type} order on ${symbol}: ${problem}`);
  }

  /** Arms the stop the BUY `order` asked for, if any, for `amount`: what that BUY filled */
  private armPendingTrailingStop({ id, symbol, orderCreationDate }: OrderInitiatedEvent['order'], amount: number) {
    const trailing = this.pendingTrailingStops.get(id);
    if (!trailing) return;
    this.pendingTrailingStops.delete(id);
    this.trailingStopManager.addOrder({ id, symbol, amount, trailing, createdAt: orderCreationDate });
  }

  /**
   * Settles the stop an errored BUY asked for. Armed for what the BUY filled when the exchange reported a fill: a STICKY order whose
   * relaunch failed, or an order whose poll or cancelation failed for good, errors after its fills, and the stop, dropped, left the
   * coins bought without protection. Dropped otherwise, with a warning: an order whose outcome is unknown (its creation lost on the
   * network) may have executed all the same, but nothing tells what to arm, and kept pending the stop would never be armed, no
   * completion following an error (the Trader relays the first end of an order only).
   */
  private settleTrailingStopOfErroredBuy(order: OrderErroredEvent['order'], filled: number) {
    const { id, symbol, amount, reason } = order;
    if (!this.pendingTrailingStops.has(id)) return;
    if (filled > 0) {
      const [asset] = symbol.split('/');
      warning(
        'strategy',
        `BUY ${id} errored after it filled ${filled} of ${amount} ${asset} (${reason}): its trailing stop is armed for that part`,
      );
      this.armPendingTrailingStop(order, filled);
      return;
    }
    warning(
      'strategy',
      [
        `Trailing stop of BUY ${id} not armed: the BUY errored, no fill reported (${reason}).`,
        'If it executed all the same, as an order whose outcome is unknown may have, what it bought has no stop',
      ].join(' '),
    );
    this.cancelTrailingOrder(id);
  }

  /**
   * Makes the stop whose SELL ended without completing active again, for what that SELL left unsold (see
   * TrailingStopManager.resumeSellingStop), with a warning. A SELL refused every time (nothing left to sell, an amount out of the
   * limits of the market) is then sent again on each minute whose price reaches the stop price, each refusal counting towards the
   * circuit breaker, which stops the bot: rather than run on with the position held without any stop. A stop removed while it sold
   * (canceled by the strategy, or by a SELL the strategy created) stays removed: that SELL is the strategy's.
   */
  private resumeTrailingStop(sellId: UUID, outcome: string, sold: number, reason?: string) {
    const stop = this.trailingStopManager.resumeSellingStop(sellId, sold);
    if (!stop) return;
    const [asset] = stop.symbol.split('/');
    const sale = sold > 0 ? ` after selling ${sold} ${asset}` : ', no fill reported';
    const ending = `${outcome}${sale}${reason ? ` (${reason})` : ''}`;
    warning(
      'strategy',
      [
        `Trailing stop of BUY ${stop.id} active again: its SELL ${sellId} ${ending}.`,
        `It sells ${stop.amount} ${asset} once a price reaches its stop price, ${stop.stopPrice},`,
        `trailing from its peak, ${stop.highestPeak}`,
      ].join(' '),
    );
  }

  /**
   * Cancels the trailing stops armed on the pair of a SELL the strategy created, once it completed: that SELL closed the position they
   * protected. Left armed, a stop outlived its position: it later sold a position the strategy opened afterwards (the Trader capping its
   * SELL to what was free), or, the strategy being flat, sent a SELL that was refused, an error counting towards the circuit breaker.
   * Every stop of the pair, whatever the amount sold: every built-in strategy sells all it holds, and an all-in SELL sells less than
   * its BUY filled when the exchange took the fee of the BUY from the asset bought, so a comparison of amounts would keep the stop. A
   * stop selling is canceled too: its SELL, sent already, is the strategy's, and is not resumed if it fails. A stop whose BUY has not
   * completed is kept: that BUY opens a position after this SELL. A SELL canceled or errored cancels nothing: the position is still
   * held, in part at least.
   */
  private cancelTrailingStopsOfPair({ id: sellId, symbol }: OrderCompletedEvent['order']) {
    const stopIds = [...this.trailingStopManager.getOrders().values()].filter(stop => stop.symbol === symbol).map(({ id }) => id);
    for (const stopId of stopIds) {
      this.cancelTrailingOrder(stopId);
      info(
        'strategy',
        `Trailing stop of BUY ${stopId} canceled: the strategy sold on ${symbol} (SELL ${sellId} completed), closing the position the stop protected`,
      );
    }
  }

  private emitWarmupCompletedEvent(bucket: CandleBucket) {
    this.isWarmupCompleted = true;
    // Use first available candle for logging timestamp
    const firstCandle = bucket.values().next().value;
    info('strategy', `Strategy warmup done ! Sending first candle bucket (${toISOString(firstCandle?.start)}) to strategy`);
    this.emit<CandleBucket>(STRATEGY_WARMUP_COMPLETED_EVENT, bucket);
  }
}
