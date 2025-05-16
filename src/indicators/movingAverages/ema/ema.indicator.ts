import { INPUT_SOURCES } from '@indicators/indicator.const';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';

export class EMA extends Indicator<'EMA'> {
  private period: number;
  private alpha: Big;
  private age: number;
  private sum: Big;
  private prevEma: Big;
  private getPrice: (candle: Candle) => number;

  constructor({ period = 30, src = 'close' }: IndicatorRegistry['EMA']['input'] = { period: 30, src: 'close' }) {
    super('EMA', null);
    this.period = period;
    this.alpha = Big(2).div(Big(period).plus(1));
    this.age = 0;
    this.sum = Big(0);
    this.prevEma = Big(0);
    this.getPrice = INPUT_SOURCES[src];
  }

  public onNewCandle(candle: Candle) {
    const price = this.getPrice(candle);
    if (this.age < this.period) {
      this.sum = this.sum.plus(price);
      this.age++;

      if (this.age === this.period) {
        this.prevEma = this.sum.div(this.period);
        this.result = +this.prevEma;
      }
      return;
    }

    this.prevEma = Big(price).minus(this.prevEma).times(this.alpha).plus(this.prevEma);
    this.result = +this.prevEma;
  }

  public getResult() {
    return this.result;
  }
}
