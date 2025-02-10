import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';

export class MinusDM extends Indicator<'MinusDM'> {
  private period: number;
  private age: number;
  private prevMinusDM: number;
  private lastCandle?: Candle;

  constructor({ period }: IndicatorRegistry['MinusDM']['input']) {
    super('MinusDM', null);
    this.period = period;
    this.age = 0;
    this.prevMinusDM = 0;
  }

  public onNewCandle(candle: Candle): void {
    const { low, high } = candle;

    const diffP = +Big(high).minus(this.lastCandle?.high ?? high);
    const diffM = +Big(this.lastCandle?.low ?? low).minus(low);
    this.lastCandle = candle;

    // Warming up
    if (this.age < this.period) {
      this.prevMinusDM += diffM > 0 && diffM > diffP ? diffM : 0;
      this.age++;
      if (this.age === this.period) this.result = this.prevMinusDM;
      return;
    }

    const base = Big(this.prevMinusDM).minus(Big(this.prevMinusDM).div(this.period));
    this.prevMinusDM = diffM > 0 && diffM > diffP ? +base.plus(diffM) : +base;
    this.result = this.prevMinusDM;
  }

  public getResult() {
    return this.result;
  }
}
