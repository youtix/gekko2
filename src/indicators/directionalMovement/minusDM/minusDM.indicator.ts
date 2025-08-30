import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/candle.types';

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

    const diffP = high - (this.lastCandle?.high ?? high);
    const diffM = (this.lastCandle?.low ?? low) - low;
    this.lastCandle = candle;

    // Warming up
    if (this.age < this.period) {
      this.prevMinusDM += diffM > 0 && diffM > diffP ? diffM : 0;
      this.age++;
      if (this.age === this.period) this.result = this.prevMinusDM;
      return;
    }

    const base = this.prevMinusDM - this.prevMinusDM / this.period;
    this.prevMinusDM = diffM > 0 && diffM > diffP ? base + diffM : base;
    this.result = this.prevMinusDM;
  }

  public getResult() {
    return this.result;
  }
}
