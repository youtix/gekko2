import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { StrategyOrder } from '@models/advice.types';
import { CandleBucket, ExchangeEvent, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { MarketData } from '@services/exchange/exchange.types';
import { UUID } from 'node:crypto';
import { z } from 'zod';
import { TrailingStopState } from './trailingStopManager.types';

export type IndicatorResults<T = unknown> = { results: T; symbol: TradingPair };
export type Direction = 'short' | 'long';
/**
 * Registers an indicator on a pair. It returns nothing: the StrategyManager keeps the indicator and feeds it, and its results reach
 * the hooks as their indicator arguments, in the order of the addIndicator calls.
 */
export type AddIndicatorFn = <T extends IndicatorNames>(name: T, symbol: TradingPair, parameters: IndicatorParamaters<T>) => void;
/** Logs a message under the strategy tag. 'error' does not return: it throws a GekkoError, which stops the bot. */
export type LoggerFn = (level: LogLevel, msg: string) => void;
export type Tools<T> = {
  /**
   * The parameters of the strategy: the output of its class's schema (see StrategyConstructor), or, for a class without one, the
   * whole top-level `strategy:` block, `name` included.
   */
  strategyParams: T;
  marketData: Map<TradingPair, MarketData>;
  log: LoggerFn;
  createOrder: (order: StrategyOrder) => UUID;
  cancelOrder: (orderId: UUID) => void;
  cancelTrailingOrder: (orderId: UUID) => void;
};
export type InitParams<T> = { candle: CandleBucket; portfolio: Portfolio; tools: Tools<T>; addIndicator: AddIndicatorFn };
export type OnCandleEventParams<T> = { candle: CandleBucket; portfolio: Portfolio; tools: Tools<T> };
export type OnOrderCompletedEventParams<T> = {
  order: OrderCompletedEvent['order'];
  exchange: ExchangeEvent;
  tools: Tools<T>;
};
export type OnOrderCanceledEventParams<T> = {
  order: OrderCanceledEvent['order'];
  exchange: ExchangeEvent;
  tools: Tools<T>;
};
export type OnOrderErroredEventParams<T> = {
  order: OrderErroredEvent['order'];
  exchange: ExchangeEvent;
  tools: Tools<T>;
};
export interface Strategy<T> {
  /** Executed once at the beginning of the strategy */
  init?(params: InitParams<T>): void;
  /** On each timeframe candle from the beginning */
  onEachTimeframeCandle?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** On each timeframe candle from the warmup event */
  onTimeframeCandleAfterWarmup?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** Let you log everything you need, called every timeframe candle after warmup */
  log?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** On each order completed successfully by the exchange */
  onOrderCompleted?(params: OnOrderCompletedEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** On each order canceled, by the strategy (tools.cancelOrder) or by the exchange (expired, canceled from its interface) */
  onOrderCanceled?(params: OnOrderCanceledEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** On each order errored, or rejected by the exchange */
  onOrderErrored?(params: OnOrderErroredEventParams<T>, ...indicators: IndicatorResults[]): void;
  /**
   * On each trailing stop activated: when the high of a one-minute candle reaches its trigger, or, for a stop without one, as soon
   * as it is armed (its BUY completed, right after onOrderCompleted). The latter has not trailed any candle yet: its highestPeak and
   * stopPrice are still 0.
   */
  onTrailingStopActivated?(state: TrailingStopState): void;
  /** On each trailing stop triggered (when trailing stop price is reached) */
  onTrailingStopTriggered?(orderId: UUID, state: TrailingStopState): void;
  /** Executed at the end of the strategy */
  end?(): void;
}

/**
 * A strategy class, as the TradingAdvisor's `strategyName` selects it: an export of `strategies/index.ts`, or, with `strategyPath`,
 * a named export of that file. The StrategyManager constructs it without arguments.
 *
 * Its optional static `schema` validates the top-level `strategy:` block once, when the strategy is created, before any candle:
 * - it receives the block without its `name` key, which only labels the run and which the configuration schema checks against
 *   `strategyName`, so it does not declare `name`;
 * - it should be a `z.strictObject`, nested objects included, so that a misspelt key is refused instead of leaving its parameter
 *   undefined;
 * - its output, defaults applied, is exactly what the strategy gets as `tools.strategyParams`, without `name`: deriving `T` from it
 *   (`z.infer<typeof schema>`) keeps the two in step.
 *
 * Any issue refuses the run with a GekkoError listing them all. A class without a schema gets the whole block, `name` included,
 * unvalidated.
 */
export type StrategyConstructor<T = object> = {
  new (): Strategy<T>;
  schema?: z.ZodType<T>;
};
