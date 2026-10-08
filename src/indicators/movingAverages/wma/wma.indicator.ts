import { Indicator } from '@indicators/indicator';
import { checkInputSource, checkInteger, getInputSource } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';

export class WMA extends Indicator<'WMA'> {
  private period: number;
  private fifo: number[];
  private divider: number;
  private age: number;
  private getPrice: (candle: Candle) => number;

  /**
   * @param period - Candles averaged, weighted 1 for the oldest to period for the last: a whole number, at least 1. Required
   * @param src - Price read from each candle: open, high, low, close, hl2, hlc3 or ohlc4. Default close
   */
  constructor({ period, src }: IndicatorRegistry['WMA']['input']) {
    super();
    checkInteger('WMA', 'period', period);
    checkInputSource('WMA', src);
    this.period = period;
    this.fifo = [];
    // divider = period * (period + 1) / 2
    this.divider = (this.period * (this.period + 1)) / 2;
    this.age = 0;
    this.getPrice = getInputSource(src);
  }

  public onNewCandle(candle: Candle): void {
    const price = this.getPrice(candle);
    // Warming up phase
    if (this.age < this.period) {
      this.fifo.push(price);
      this.age++;
      // Compute first value
      if (this.age === this.period) this.result = this.computeWMA();
      return;
    }

    this.fifo.shift();
    this.fifo.push(price);
    this.result = this.computeWMA();
  }

  private computeWMA() {
    const periodSum = this.fifo.reduce((res, price, i) => res + price * (i + 1), 0);
    return periodSum / this.divider;
  }
}
