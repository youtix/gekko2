import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/candle.types';

/**
 * Wilder's smoothing: the mean of the first period values, then ((period − 1) × previous + value) / period. SMMA is this class
 * under another name, and ATR, RSI and ADX smooth with it, so a change here changes them and the indicators built on them.
 */
export class WilderSmoothing extends Indicator<'WilderSmoothing'> {
  private period: number;
  private age: number;
  private sum: number;
  private prevSmoothed: number;

  constructor({ period = 14 }: IndicatorRegistry['WilderSmoothing']['input'] = {}) {
    super();
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
}
