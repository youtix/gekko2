import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';

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

    const diffP = +Big(high).minus(this.lastCandle?.high ?? high);
    const diffM = +Big(this.lastCandle?.low ?? low).minus(low);
    this.lastCandle = candle;

    // Warming up
    if (this.age < this.period) {
      this.prevPlusDM += diffP > 0 && diffP > diffM ? diffP : 0;
      this.age++;
      if (this.age === this.period) this.result = this.prevPlusDM;
      return;
    }

    const base = Big(this.prevPlusDM).minus(Big(this.prevPlusDM).div(this.period));
    this.prevPlusDM = diffP > 0 && diffP > diffM ? +base.plus(diffP) : +base;
    this.result = this.prevPlusDM;
  }

  public getResult() {
    return this.result;
  }
}
