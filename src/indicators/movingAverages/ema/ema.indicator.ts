import { checkInputSource, checkInteger, getInputSource } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';
import { Indicator } from '../../indicator';

export class EMA extends Indicator<'EMA'> {
  private period: number;
  private alpha: number;
  private age: number;
  private sum: number;
  private prevEma: number;
  private getPrice: (candle: Candle) => number;

  /**
   * @param period - Candles averaged, with the weight 2 / (period + 1) on the last: a whole number, at least 1. Default 30
   * @param src - Price read from each candle: open, high, low, close, hl2, hlc3 or ohlc4. Default close
   */
  constructor({ period = 30, src }: IndicatorRegistry['EMA']['input'] = {}) {
    super();
    checkInteger('EMA', 'period', period);
    checkInputSource('EMA', src);
    this.period = period;
    this.alpha = 2 / (period + 1);
    this.age = 0;
    this.sum = 0;
    this.prevEma = 0;
    this.getPrice = getInputSource(src);
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
}
