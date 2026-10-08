import { Candle } from '@models/candle.types';
import { IndicatorNames } from './indicator.types';

/**
 * The result is null until the indicator has seen enough candles, then always a complete value of its output type: a number, or an
 * object whose declared fields are all set. Never a partial object or a placeholder number. Indicators used to start some objects
 * with null fields, fill them in one by one, or start at 0, so a strategy that only checked for null read a warming-up value.
 */
export abstract class Indicator<T extends IndicatorNames = IndicatorNames> {
  protected result: IndicatorRegistry[T]['output'] | null = null;

  public abstract onNewCandle(candle: Candle): void;

  public getResult(): IndicatorRegistry[T]['output'] | null {
    return this.result;
  }
}
