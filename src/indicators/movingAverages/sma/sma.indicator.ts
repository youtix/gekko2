import { INPUT_SOURCES } from '@indicators/indicator.const';
import { Candle } from '@models/candle.types';
import { Indicator } from '../../indicator';

export class SMA extends Indicator<'SMA'> {
  private period: number;
  private buffer: number[];
  private idx: number;
  private age: number;
  private sum: number;
  private getPrice: (candle: Candle) => number;

  constructor({ period = 30, src = 'close' }: IndicatorRegistry['SMA']['input'] = {}) {
    super('SMA', null);
    this.period = period;
    this.buffer = [];
    this.idx = 0;
    this.age = 0;
    this.sum = 0;
    this.getPrice = INPUT_SOURCES[src];
  }

  public onNewCandle(candle: Candle) {
    const price = this.getPrice(candle);
    // Warming up period
    if (this.age < this.period) {
      this.age++;
      this.sum += price;
      this.buffer[this.idx] = price;
      this.idx = (this.idx + 1) % this.period;
      if (this.age === this.period) this.result = this.sum / this.period;
      return;
    }

    this.sum = this.sum - this.buffer[this.idx] + price;
    this.buffer[this.idx] = price;
    this.idx = (this.idx + 1) % this.period;

    this.result = this.sum / this.period;
  }

  public getResult() {
    return this.result;
  }
}
