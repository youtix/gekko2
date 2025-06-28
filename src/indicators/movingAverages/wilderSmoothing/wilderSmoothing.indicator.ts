import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';

export class WilderSmoothing extends Indicator<'WilderSmoothing'> {
  private period: number;
  private age: number;
  private sum: number;
  private prevSmoothed: number;

  constructor({ period }: IndicatorRegistry['WilderSmoothing']['input'] = { period: 14 }) {
    super('WilderSmoothing', null);
    this.period = period;
    this.age = 0;
    this.sum = 0;
    this.prevSmoothed = 0;
  }

  public onNewCandle({ close }: Candle): void {
    // Warmup: accumulate first 'period' values for simple average
    if (this.age < this.period) {
      this.sum += close;
      this.age++;

      // Once enough data, initialize smoothed value
      if (this.age === this.period) {
        this.prevSmoothed = this.sum / this.period;
        this.result = this.prevSmoothed;
      }
      return;
    }

    // Wilder's smoothing: (prev*(period-1) + close) / period
    this.prevSmoothed = (this.prevSmoothed * (this.period - 1) + close) / this.period;
    this.result = this.prevSmoothed;
  }

  public getResult() {
    return this.result;
  }
}
