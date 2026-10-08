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
 *
 * `symbol` must be a watched pair, a key of `tools.marketData`: an indicator on any other pair would never get a candle, its results
 * null for the whole run. Any other symbol throws a GekkoError naming it and the watched pairs: the bot stops.
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
  /** The limits, precision and fees of each watched pair, by pair: its keys are the pairs createOrder and addIndicator accept */
  marketData: Map<TradingPair, MarketData>;
  log: LoggerFn;
  /**
   * Relays an order to the Trader and returns its id at once: the outcome arrives through onOrderCompleted, onOrderCanceled or
   * onOrderErrored. The order is dated (`orderCreationDate`) with the end of the minute being processed.
   *
   * Available once the warmup is over: from log and onTimeframeCandleAfterWarmup on the candle that completes it (the first one
   * with `warmup.candleCount: 0`), then from every hook. Before that, and so always in init, it throws a GekkoError: the bot stops.
   *
   * `symbol` must be a watched pair, a key of `marketData`: Gekko has no candle, price or balance of any other pair, so it could
   * neither follow the position nor trail its stop, while a live exchange would still execute the order. Any other symbol throws a
   * GekkoError naming it and the watched pairs, and the order is not sent: the bot stops.
   *
   * A `trailing` is checked before anything is relayed: on a BUY only, with a percentage above 0 and below 100 and a trigger above 0
   * or left out. Anything else throws a GekkoError and the order is not sent: the bot stops. The stop is armed, once the BUY
   * completes, from a copy taken here: changing the object afterwards moves nothing.
   *
   * A stop protects the position its BUY opened until the strategy sells on that pair: once a SELL the strategy created completes
   * there, every stop armed on the pair is canceled, whatever the amount sold, with a line at info level. So a strategy that scales
   * out loses its stops at its first SELL. The SELL a stop sends cancels no other stop, and a stop whose BUY has not completed yet is
   * kept: it protects the position that BUY opens.
   *
   * A BUY that errors after filling part of its amount (`order.filled` in onOrderErrored) gets its stop for that part, with a
   * warning. One that errors with no fill reported loses it, with a warning too: an order whose outcome is unknown may have executed
   * all the same. A BUY canceled loses its stop, even after a partial fill.
   */
  createOrder: (order: StrategyOrder) => UUID;
  cancelOrder: (orderId: UUID) => void;
  /**
   * Cancels the trailing stop of the BUY `orderId` (TrailingStopState.id), before or after the BUY completes, and while the stop
   * sells: the SELL it sent is then the strategy's alone, and its failure no longer brings the stop back (see
   * Strategy.onTrailingStopTriggered). A strategy that exits need not call it: its SELL cancels the stops of the pair once it
   * completes (see createOrder). Until then they protect the position, and one may trigger while that SELL is pending: its own SELL
   * is then refused if nothing is left to sell, and the stop, active again, sends it again on each minute at or below its stop price
   * until the strategy's SELL ends, each refusal counting towards the circuit breaker. Canceling the stops before sending the SELL
   * rules that out, but leaves the position unprotected if that SELL fails.
   */
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
  /** Executed once at the beginning of the strategy, on the first timeframe candle, before the warmup is over: no orders here */
  init?(params: InitParams<T>): void;
  /**
   * On each timeframe candle from the beginning, the warmup included, before log and onTimeframeCandleAfterWarmup: it can create
   * orders from the candle after the one that completes the warmup (see Tools.createOrder).
   */
  onEachTimeframeCandle?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** On each timeframe candle from the warmup event */
  onTimeframeCandleAfterWarmup?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** Let you log everything you need, called every timeframe candle after warmup */
  log?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** On each order completed successfully by the exchange */
  onOrderCompleted?(params: OnOrderCompletedEventParams<T>, ...indicators: IndicatorResults[]): void;
  /** On each order canceled, by the strategy (tools.cancelOrder) or by the exchange (expired, canceled from its interface) */
  onOrderCanceled?(params: OnOrderCanceledEventParams<T>, ...indicators: IndicatorResults[]): void;
  /**
   * On each order errored, or rejected by the exchange. It may have executed part of its amount first: `order.filled` is what the
   * exchange reported it filled, 0 when it reported nothing, which does not prove that nothing executed (an order whose outcome is
   * unknown says so in its reason).
   */
  onOrderErrored?(params: OnOrderErroredEventParams<T>, ...indicators: IndicatorResults[]): void;
  /**
   * On each trailing stop activated: when the high of a one-minute candle reaches its trigger, or, for a stop without one, as soon
   * as it is armed (its BUY completed, right after onOrderCompleted). The latter has not trailed any candle yet: its highestPeak and
   * stopPrice are still 0. The former's peak is that candle's open when the open reached the trigger, else its high; the rest of the
   * candle is trailed after this hook (see TrailingStopState.highestPeak), unless the stop is canceled here
   * (tools.cancelTrailingOrder(state.id), state.id being its BUY's id).
   *
   * `tools` is the object every other hook gets, passed last so that a hook written with the state alone still fits.
   */
  onTrailingStopActivated?(state: TrailingStopState, tools: Tools<T>): void;
  /**
   * On each trailing stop triggered: when a price of a one-minute candle, met as open, low, high, close, reaches the stop price (see
   * TrailingStopState.highestPeak). The state holds the peak and the stop price of that moment.
   *
   * `orderId` is the MARKET SELL the StrategyManager has just created for the stop, of the amount the stop protects (state.amount). From
   * now on it is an order of the strategy's own: its outcome comes through onOrderCompleted, onOrderCanceled or onOrderErrored, under
   * that id, and a strategy that tracks its position adopts it as its pending SELL (see PositionTracker.adoptSell). Not adopted, it
   * leaves the strategy long once the stop has sold everything, and the SELL the strategy advises next is refused: nothing is left.
   *
   * The stop sells until that SELL ends (state.status 'selling', state.sellOrderId): completed, the stop is over. Errored or canceled,
   * the stop is active again, with a warning and without onTrailingStopActivated, for what that SELL did not sell, from the peak and
   * the stop price it triggered at: the next price at or below that stop price triggers it again, and this hook announces its new
   * SELL, under a new id. A SELL refused every time (nothing left to sell, an amount out of the limits of the market) is so sent again
   * on each such minute, each refusal counting towards the circuit breaker, which stops the bot. A strategy that takes over, with a
   * SELL of its own once that one failed, cancels the stop first (tools.cancelTrailingOrder(state.id)).
   *
   * `tools` is the object every other hook gets, passed last so that a hook written without it still fits.
   */
  onTrailingStopTriggered?(orderId: UUID, state: TrailingStopState, tools: Tools<T>): void;
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
