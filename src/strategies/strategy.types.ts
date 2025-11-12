import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { AdviceOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { LogLevel } from '@models/logLevel.types';
import { Portfolio } from '@models/portfolio.types';
import { OrderCanceled, OrderCompleted, OrderErrored } from '@models/order.types';
import { UUID } from 'node:crypto';

export type Direction = 'short' | 'long';
export type AddIndicatorFn = <T extends IndicatorNames>(name: T, parameters: IndicatorParamaters<T>) => void;
export type LoggerFn = (level: LogLevel, msg: string) => void;
export type Tools<T> = {
  candle: Candle;
  strategyParams: T;
  portfolio: Portfolio;
  log: LoggerFn;
  createOrder: (order: AdviceOrder) => UUID;
  cancelOrder: (orderId: UUID) => void;
};
export interface Strategy<T> {
  /** Executed at the beginning of the strategy */
  init(tools: Tools<T>, addIndicator: AddIndicatorFn): void;
  /** On each candle from the beginning */
  onEachCandle(tools: Tools<T>, ...indicators: unknown[]): void;
  /** On each candle from the warmup event */
  onCandleAfterWarmup(tools: Tools<T>, ...indicators: unknown[]): void;
  /** On each order completed successfuly by exchange */
  onOrderCompleted(order: OrderCompleted): void;
  /** On each order canceled successfuly by exchange */
  onOrderCanceled(order: OrderCanceled): void;
  /** On each order errored/rejected by exchange */
  onOrderErrored(order: OrderErrored): void;
  /** Let you log everything you need */
  log(tools: Tools<T>, ...indicators: unknown[]): void;
  /** Executed at the end of the strategy */
  end(): void;
}
