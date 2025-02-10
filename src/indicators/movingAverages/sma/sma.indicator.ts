import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';

export class SMA extends Indicator<'SMA'> {
  private prices: number[];
  private age: number;
  private sum: number;
  private period: number;

  constructor({ period }: IndicatorRegistry['SMA']['input']) {
    super('SMA', NaN);
    this.prices = [];
    this.age = 0;
    this.sum = 0;
    this.period = period;
  }

  public onNewCandle(candle: Candle) {
    const tail = this.prices[this.age] ?? 0;
    this.prices[this.age] = candle.close;
    this.sum = +Big(candle.close).minus(tail).plus(this.sum);
    this.result = +Big(this.sum).div(this.prices.length);
    this.age = +Big(this.age).plus(1).mod(this.period);
  }

  public getResult() {
    return this.result;
  }
}
