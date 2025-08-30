import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/candle.types';

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
    this.divider = (this.period * (this.period + 1)) / 2;
    this.age = 0;
  }

  public onNewCandle({ close }: Candle): void {
    // Warming up phase
    if (this.age < this.period) {
      this.fifo.push(close);
      this.age++;
      // Compute first value
      if (this.age === this.period) this.result = this.computeWMA();
      return;
    }

    this.fifo.shift();
    this.fifo.push(close);
    this.result = this.computeWMA();
  }

  private computeWMA() {
    const periodSum = this.fifo.reduce((res, price, i) => res + price * (i + 1), 0);
    return periodSum / this.divider;
  }

  public getResult() {
    return this.result;
  }
}
