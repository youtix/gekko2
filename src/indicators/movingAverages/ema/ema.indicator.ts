import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';

export class EMA extends Indicator<'EMA'> {
  private weight: number;

  constructor({ weight }: IndicatorRegistry['EMA']['input']) {
    super('EMA', NaN);
    this.weight = weight;
  }

  public onNewCandle({ close }: Candle) {
    const k = Big(2).div(Big(this.weight).plus(1));

    // yesterday
    const y = !Number.isNaN(this.result) ? Big(this.result) : Big(close);

    // calculation
    this.result = +Big(close)
      .mul(k)
      .plus(y.mul(Big(1).minus(k)));
  }

  public getResult() {
    return this.result;
  }
}
