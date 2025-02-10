import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';

export class WMA extends Indicator<'WMA'> {
  private period: number;
  private fifo: number[];
  private divider: number;
  private age: number;

  constructor({ period }: IndicatorRegistry['WMA']['input']) {
    super('WMA', null);
    this.period = period;
    this.fifo = [];
    // divider = period * (period + 1) / 2
    this.divider = +Big(this.period)
      .mul(this.period + 1)
      .div(2);
    this.age = 0;
  }

  public onNewCandle({ close }: Candle): void {
    // Warming up phase
    if (this.age < this.period) {
      this.fifo = [...this.fifo, close];
      this.age++;
      // Compute first value
      if (this.age === this.period) this.result = this.computeWMA();
      return;
    }

    const [, ...rest] = this.fifo;
    this.fifo = [...rest, close];
    this.result = this.computeWMA();
  }

  private computeWMA() {
    const periodSum = this.fifo.reduce((res, price, i) => +Big(res).plus(Big(price).times(i + 1)), 0);
    return +Big(periodSum).div(this.divider);
  }

  public getResult() {
    return this.result;
  }
}
