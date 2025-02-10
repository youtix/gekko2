import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';

export class EMA extends Indicator<'EMA'> {
  private period: number;

  constructor({ period }: IndicatorRegistry['EMA']['input']) {
    super('EMA', null);
    this.period = period;
  }

  public onNewCandle({ close }: Candle) {
    const k = Big(2).div(Big(this.period).plus(1));

    // yesterday
    const y = Big(this.result ?? close);

    // calculation
    this.result = +Big(close)
      .mul(k)
      .plus(y.mul(Big(1).minus(k)));
  }

  public getResult() {
    return this.result;
  }
}
