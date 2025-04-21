import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';

export class SMA extends Indicator<'SMA'> {
  private period: number;
  private buffer: number[];
  private idx: number;
  private age: number;
  private sum: Big;

  constructor({ period }: IndicatorRegistry['SMA']['input']) {
    super('SMA', null);
    this.period = period;
    this.buffer = [];
    this.idx = 0;
    this.age = 0;
    this.sum = Big(0);
  }

  public onNewCandle({ close }: Candle) {
    // Warming up period
    if (this.age < this.period) {
      this.age++;
      this.sum = this.sum.plus(close);
      this.buffer[this.idx] = close;
      this.idx = (this.idx + 1) % this.period;
      if (this.age === this.period) this.result = +this.sum.div(this.period);
      return;
    }

    this.sum = this.sum.minus(this.buffer[this.idx]).plus(close);
    this.buffer[this.idx] = close;
    this.idx = (this.idx + 1) % this.period;

    this.result = +this.sum.div(this.period);
  }

  public getResult() {
    return this.result;
  }
}
