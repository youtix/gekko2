import { Indicator } from '@indicators/indicator';
import { checkInteger } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';

export class PlusDM extends Indicator<'PlusDM'> {
  private period: number;
  private age: number;
  private prevPlusDM: number;
  private lastCandle?: Candle;

  /** @param period - Candles of the first sum, and the divisor of the smoothing: a whole number, at least 1. Required */
  constructor({ period }: IndicatorRegistry['PlusDM']['input']) {
    super();
    checkInteger('PlusDM', 'period', period);
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
}
