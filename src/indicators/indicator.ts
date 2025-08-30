import { Candle } from '@models/candle.types';
import { IndicatorNames } from './indicator.types';

export abstract class Indicator<T extends IndicatorNames = IndicatorNames> {
  protected name: IndicatorNames;
  protected result: IndicatorRegistry[T]['output'];

  constructor(name: T, result: IndicatorRegistry[T]['output']) {
    this.name = name;
    this.result = result;
  }

  public getName() {
    return this.name;
  }

  public abstract onNewCandle(candle: Candle): void;
  public abstract getResult(): IndicatorRegistry[T]['output'];
}
