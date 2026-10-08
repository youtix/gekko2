import { Indicator } from '@indicators/indicator';
import { checkInteger } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';

export class PlusDM extends Indicator<'PlusDM'> {
  private period: number;
  private age: number;
  private prevPlusDM: number;
  private lastCandle?: Candle;

  /**
   * @param period - Candles of the first sum, and the divisor of the smoothing: a whole number, at least 1, where 1 gives each
   * candle's own +DM. Required
   */
  constructor({ period }: IndicatorRegistry['PlusDM']['input']) {
    super();
    checkInteger('PlusDM', 'period', period);
    this.period = period;
    this.age = 0;
    this.prevPlusDM = 0;
  }

  public onNewCandle(candle: Candle): void {
    const { low, high } = candle;
    const lastCandle = this.lastCandle;
    this.lastCandle = candle;
    this.age++;

    // The first candle has no previous one to move from. It counted as a move of 0, which period 1 published as a made-up first value:
    // as in TA-Lib, +DM starts at the second candle, and with period 1 it is each candle's own move, since prev − prev / 1 is 0
    if (!lastCandle) return;

    const diffP = high - lastCandle.high;
    const diffM = lastCandle.low - low;
    const plusDM = diffP > 0 && diffP > diffM ? diffP : 0;

    // Warming up
    if (this.age <= this.period) {
      this.prevPlusDM += plusDM;
      if (this.age === this.period) this.result = this.prevPlusDM;
      return;
    }

    this.prevPlusDM = this.prevPlusDM - this.prevPlusDM / this.period + plusDM;
    this.result = this.prevPlusDM;
  }
}
