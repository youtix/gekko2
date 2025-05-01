import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';

export class WilderSmoothing extends Indicator<'WilderSmoothing'> {
  private period: number;
  private age: number;
  private sum: Big;
  private prevSmoothed: Big;

  constructor({ period }: IndicatorRegistry['WilderSmoothing']['input'] = { period: 14 }) {
    super('WilderSmoothing', null);
    this.period = period;
    this.age = 0;
    this.sum = Big(0);
    this.prevSmoothed = Big(0);
  }

  public onNewCandle({ close }: Candle): void {
    // Warmup: accumulate first 'period' values for simple average
    if (this.age < this.period) {
      this.sum = this.sum.plus(close);
      this.age++;

      // Once enough data, initialize smoothed value
      if (this.age === this.period) {
        this.prevSmoothed = this.sum.div(this.period);
        this.result = +this.prevSmoothed;
      }
      return;
    }

    // Wilder's smoothing: (prev*(period-1) + close) / period
    this.prevSmoothed = this.prevSmoothed
      .times(this.period - 1)
      .plus(close)
      .div(this.period);
    this.result = +this.prevSmoothed;
  }

  public getResult() {
    return this.result;
  }
}
