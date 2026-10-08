import { Indicator } from '@indicators/indicator';
import { getInputSource } from '@indicators/indicator.utils';
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
  private getPrice: (candle: Candle) => number;

  constructor({ period = 14, src }: IndicatorRegistry['WilderSmoothing']['input'] = {}) {
    super();
    this.period = period;
    this.age = 0;
    this.sum = 0;
    this.prevSmoothed = 0;
    this.getPrice = getInputSource(src);
  }

  public onNewCandle(candle: Candle): void {
    const price = this.getPrice(candle);
    // Warmup: accumulate first 'period' values for simple average
    if (this.age < this.period) {
      this.sum += price;
      this.age++;

      // Once enough data, initialize smoothed value
      if (this.age === this.period) {
        this.prevSmoothed = this.sum / this.period;
        this.result = this.prevSmoothed;
      }
      return;
    }

    // Wilder's smoothing: (prev*(period-1) + price) / period
    this.prevSmoothed = (this.prevSmoothed * (this.period - 1) + price) / this.period;
    this.result = this.prevSmoothed;
  }
}
