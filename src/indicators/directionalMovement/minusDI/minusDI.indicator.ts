import { Indicator } from '@indicators/indicator';
import { TrueRange } from '@indicators/volatility';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { MinusDM } from '../minusDM/minusDM.indicator';

export class MinusDI extends Indicator<'MinusDI'> {
  private age: number;
  private minusDM: MinusDM;
  private period: number;
  private prevTR: number;
  private trueRange: TrueRange;

  constructor({ period }: IndicatorRegistry['MinusDI']['input']) {
    super('MinusDI', null);
    this.age = 0;
    this.minusDM = new MinusDM({ period });
    this.period = period;
    this.prevTR = 0;
    this.trueRange = new TrueRange();
  }

  public onNewCandle(candle: Candle): void {
    this.trueRange.onNewCandle(candle);
    this.minusDM.onNewCandle(candle);

    const trueRange = this.trueRange.getResult() ?? 0;

    // Warm-up phase: accumulate values until we have enough candles.
    if (this.age < this.period) {
      this.prevTR += trueRange;
      this.age++;
      return;
    }

    const baseTR = Big(this.prevTR).minus(Big(this.prevTR).div(this.period));
    const newTR = +baseTR.plus(trueRange);
    const newMinusDM = this.minusDM.getResult() ?? 0;

    this.result = newTR === 0 ? 0 : +Big(100).times(Big(newMinusDM).div(newTR));
    this.prevTR = newTR;
  }

  public getResult(): number | null {
    return this.result;
  }
}
