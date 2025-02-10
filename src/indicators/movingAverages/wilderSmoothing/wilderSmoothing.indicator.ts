import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';

export class WilderSmoothing extends Indicator<'WilderSmoothing'> {
  private age: number;
  private period: number;
  private sum: number;

  constructor({ period }: IndicatorRegistry['WilderSmoothing']['input']) {
    super('WilderSmoothing', null);
    this.period = period ?? 14;
    this.age = 0;
    this.sum = 0;
  }

  public onNewCandle({ close }: Candle): void {
    // Warming up phase
    if (this.age < this.period - 1) {
      this.sum = +Big(this.sum).plus(close);
      this.age++;
      return;
    }

    // Compute the initial value
    if (this.age === this.period - 1) {
      this.sum = +Big(this.sum).plus(close);
      this.result = +Big(this.sum).div(this.period);
      this.age++;
      return;
    }

    this.result = +Big(this.period - 1)
      .mul(this.result ?? 0)
      .plus(close)
      .div(this.period);
  }

  public getResult() {
    return this.result;
  }
}
