import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { AdviceOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { LogLevel } from '@models/logLevel.types';
import { OrderCompleted, OrderErrored } from '@models/order.types';
import { UUID } from 'node:crypto';

export type Direction = 'short' | 'long';
export type AddIndicatorFn = <T extends IndicatorNames>(name: T, parameters: IndicatorParamaters<T>) => void;
export type LoggerFn = (level: LogLevel, msg: string) => void;
export type Tools<T> = {
  candle: Candle;
  strategyParams: T;
  log: LoggerFn;
  createOrder: (order: AdviceOrder) => UUID;
  cancelOrder: (orderId: UUID) => void;
};
export interface Strategy<T> {
  init(addIndicator: AddIndicatorFn, strategyParams: T): void;
  onEachCandle(tools: Tools<T>, ...indicators: unknown[]): void;
  onCandleAfterWarmup(tools: Tools<T>, ...indicators: unknown[]): void;
  onOrderCompleted(order: OrderCompleted): void;
  onOrderErrored(order: OrderErrored): void;
  log(tools: Tools<T>, ...indicators: unknown[]): void;
  end(): void;
}
