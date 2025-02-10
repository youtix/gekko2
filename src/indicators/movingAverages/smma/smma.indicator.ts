import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { SMA } from '../sma/sma.indicator';

export class SMMA extends Indicator<'SMMA'> {
  private age: number;
  private weight: number;
  private sma: SMA;

  constructor({ weight }: IndicatorRegistry['SMMA']['input']) {
    super('SMMA', 0);
    this.sma = new SMA({ weight });
    this.age = 0;
    this.weight = weight;
  }

  public onNewCandle(candle: Candle) {
    if (this.age < this.weight - 1) {
      this.sma.onNewCandle(candle);
      this.age++;
    } else if (this.age === this.weight - 1) {
      this.sma.onNewCandle(candle);
      this.result = this.sma.getResult();
      this.age++;
    } else {
      this.result = +Big(this.weight)
        .minus(1)
        .mul(this.result ?? 0)
        .add(candle.close)
        .div(this.weight);
    }
  }

  public getResult() {
    return this.result;
  }
}
