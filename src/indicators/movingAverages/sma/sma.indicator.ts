import { INPUT_SOURCES } from '@indicators/indicator.const';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';

export class SMA extends Indicator<'SMA'> {
  private period: number;
  private buffer: number[];
  private idx: number;
  private age: number;
  private sum: Big;
  private getPrice: (candle: Candle) => number;

  constructor({ period = 30, src = 'close' }: IndicatorRegistry['SMA']['input'] = {}) {
    super('SMA', null);
    this.period = period;
    this.buffer = [];
    this.idx = 0;
    this.age = 0;
    this.sum = Big(0);
    this.getPrice = INPUT_SOURCES[src];
  }

  public onNewCandle(candle: Candle) {
    const price = this.getPrice(candle);
    // Warming up period
    if (this.age < this.period) {
      this.age++;
      this.sum = this.sum.plus(price);
      this.buffer[this.idx] = price;
      this.idx = (this.idx + 1) % this.period;
      if (this.age === this.period) this.result = +this.sum.div(this.period);
      return;
    }

    this.sum = this.sum.minus(this.buffer[this.idx]).plus(price);
    this.buffer[this.idx] = price;
    this.idx = (this.idx + 1) % this.period;

    this.result = +this.sum.div(this.period);
  }

  public getResult() {
    return this.result;
  }
}
