import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { Candle } from '@models/types/candle.types';
import { Tag } from '@models/types/tag.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';

export type Direction = 'short' | 'long';
export type AddIndicatorFn = <T extends IndicatorNames>(name: T, parameters: IndicatorParamaters<T>) => void;
export type LoggerFn = (tag: Tag, message: unknown) => void;
export type AdviceFn = (newDirection: Direction) => number | undefined;
export type Tools<T> = {
  candle: Candle;
  strategyParams: T;
  debug: LoggerFn;
  info: LoggerFn;
  warning: LoggerFn;
  error: LoggerFn;
  advice: AdviceFn;
};
export interface Strategy<T> {
  init(addIndicator: AddIndicatorFn, strategyParams: T): void;
  onEachCandle(tools: Tools<T>, ...indicators: unknown[]): void;
  onCandleAfterWarmup(tools: Tools<T>, ...indicators: unknown[]): void;
  onTradeCompleted(trade: TradeCompleted): void;
  log(tools: Tools<T>, ...indicators: unknown[]): void;
  end(): void;
}
