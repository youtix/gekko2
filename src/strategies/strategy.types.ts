import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { AdviceOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { ExchangeEvent, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { Portfolio } from '@models/portfolio.types';
import { MarketLimits } from '@services/exchange/exchange.types';
import { UUID } from 'node:crypto';

export type Direction = 'short' | 'long';
export type AddIndicatorFn = <T extends IndicatorNames>(name: T, parameters: IndicatorParamaters<T>) => void;
export type LoggerFn = (level: LogLevel, msg: string) => void;
export type Tools<T> = {
  strategyParams: T;
  marketLimits: MarketLimits;
  log: LoggerFn;
  createOrder: (order: Omit<AdviceOrder, 'id' | 'orderCreationDate'>) => UUID;
  cancelOrder: (orderId: UUID) => void;
};
export type InitParams<T> = { candle: Candle; portfolio: Portfolio; tools: Tools<T>; addIndicator: AddIndicatorFn };
export type OnCandleEventParams<T> = { candle: Candle; portfolio: Portfolio; tools: Tools<T> };
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
  /** Executed at the end of the strategy */
  end(): void;
}
