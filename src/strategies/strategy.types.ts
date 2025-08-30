import { IndicatorNames, IndicatorParamaters } from '@indicators/indicator.types';
import { Candle } from '@models/candle.types';
import { LogLevel } from '@models/logLevel.types';
import { TradeCompleted } from '@models/tradeStatus.types';

export type Direction = 'short' | 'long';
export type AddIndicatorFn = <T extends IndicatorNames>(name: T, parameters: IndicatorParamaters<T>) => void;
export type LoggerFn = (level: LogLevel, msg: string) => void;
export type AdviceFn = (newDirection: Direction) => number | undefined;
export type Tools<T> = {
  candle: Candle;
  strategyParams: T;
  log: LoggerFn;
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
