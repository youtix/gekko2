import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';

export class PlusDM extends Indicator<'PlusDM'> {
  private period: number;
  private age: number;
  private prevPlusDM: number;
  private lastCandle?: Candle;

  constructor({ period }: IndicatorRegistry['PlusDM']['input']) {
    super('PlusDM', null);
    this.period = period;
    this.age = 0;
    this.prevPlusDM = 0;
  }

  public onNewCandle(candle: Candle): void {
    const { low, high } = candle;

    const diffP = high - (this.lastCandle?.high ?? high);
    const diffM = (this.lastCandle?.low ?? low) - low;
    this.lastCandle = candle;

    // Warming up
    if (this.age < this.period) {
      this.prevPlusDM += diffP > 0 && diffP > diffM ? diffP : 0;
      this.age++;
      if (this.age === this.period) this.result = this.prevPlusDM;
      return;
    }

    const base = this.prevPlusDM - this.prevPlusDM / this.period;
    this.prevPlusDM = diffP > 0 && diffP > diffM ? base + diffP : base;
    this.result = this.prevPlusDM;
  }

  public getResult() {
    return this.result;
  }
}
