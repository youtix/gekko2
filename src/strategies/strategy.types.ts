import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { AdviceOrder } from '@models/advice.types';
import { CandleBucket, ExchangeEvent, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { MarketData } from '@services/exchange/exchange.types';
import { UUID } from 'node:crypto';
import { TrailingStopState } from './trailingStopManager.types';

export type Direction = 'short' | 'long';
export type AddIndicatorFn = <T extends IndicatorNames>(name: T, symbol: TradingPair, parameters: IndicatorParamaters<T>) => void;
export type LoggerFn = (level: LogLevel, msg: string) => void;
export type Tools<T> = {
  strategyParams: T;
  marketData: Map<TradingPair, MarketData>;
  log: LoggerFn;
  createOrder: (order: Omit<AdviceOrder, 'id' | 'orderCreationDate'>) => UUID;
  cancelOrder: (orderId: UUID) => void;
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
interface IStrategy<T> {
  /** Executed once at the beginning of the strategy */
  init(params: InitParams<T>): void;
  /** On each timeframe candle from the beginning */
  onEachTimeframeCandle(params: OnCandleEventParams<T>, ...indicators: unknown[]): void;
  /** On each timeframe candle from the warmup event */
  onTimeframeCandleAfterWarmup(params: OnCandleEventParams<T>, ...indicators: unknown[]): void;
  /** Let you log everything you need, called every timeframe candle after warmup */
  log(params: OnCandleEventParams<T>, ...indicators: unknown[]): void;
  /** On each order completed successfuly by exchange */
  onOrderCompleted(params: OnOrderCompletedEventParams<T>, ...indicators: unknown[]): void;
  /** On each order canceled successfuly by exchange */
  onOrderCanceled(params: OnOrderCanceledEventParams<T>, ...indicators: unknown[]): void;
  /** On each order errored/rejected by exchange */
  onOrderErrored(params: OnOrderErroredEventParams<T>, ...indicators: unknown[]): void;
  /** On each trailing stop activated (when activation threshold price is reached) */
  onTrailingStopActivated(state: TrailingStopState): void;
  /** On each trailing stop triggered (when trailing stop price is reached) */
  onTrailingStopTriggered(orderId: UUID, state: TrailingStopState): void;
  /** Executed at the end of the strategy */
  end(): void;
}

export abstract class Strategy<T> implements IStrategy<T> {
  public init(_params: InitParams<T>): void {}
  public onEachTimeframeCandle(_params: OnCandleEventParams<T>, ..._indicators: unknown[]): void {}
  public onTimeframeCandleAfterWarmup(_params: OnCandleEventParams<T>, ..._indicators: unknown[]): void {}
  public log(_params: OnCandleEventParams<T>, ..._indicators: unknown[]): void {}
  public onOrderCompleted(_params: OnOrderCompletedEventParams<T>, ..._indicators: unknown[]): void {}
  public onOrderCanceled(_params: OnOrderCanceledEventParams<T>, ..._indicators: unknown[]): void {}
  public onOrderErrored(_params: OnOrderErroredEventParams<T>, ..._indicators: unknown[]): void {}
  public onTrailingStopActivated(_state: TrailingStopState): void {}
  public onTrailingStopTriggered(_orderId: UUID, _state: TrailingStopState): void {}
  public end(): void {}
}
