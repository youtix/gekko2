import { INPUT_SOURCES } from '@indicators/indicator.const';
import { Candle } from '@models/candle.types';
import { Indicator } from '../../indicator';

export class EMA extends Indicator<'EMA'> {
  private period: number;
  private alpha: number;
  private age: number;
  private sum: number;
  private prevEma: number;
  private getPrice: (candle: Candle) => number;

  constructor({ period = 30, src = 'close' }: IndicatorRegistry['EMA']['input'] = {}) {
    super('EMA', null);
    this.period = period;
    this.alpha = 2 / (period + 1);
    this.age = 0;
    this.sum = 0;
    this.prevEma = 0;
    this.getPrice = INPUT_SOURCES[src];
  }

  public onNewCandle(candle: Candle) {
    const price = this.getPrice(candle);
    if (this.age < this.period) {
      this.sum += price;
      this.age++;

      if (this.age === this.period) {
        this.prevEma = this.sum / this.period;
        this.result = this.prevEma;
      }
      return;
    }

    this.prevEma = (price - this.prevEma) * this.alpha + this.prevEma;
    this.result = this.prevEma;
  }

  public getResult() {
    return this.result;
  }
}
