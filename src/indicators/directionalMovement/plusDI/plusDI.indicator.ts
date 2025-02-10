import { TrueRange } from '@indicators/volatility';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';
import { PlusDM } from '../plusDM/plusDM.indicator';

export class PlusDI extends Indicator {
  private age: number;
  private period: number;
  private plusDM: PlusDM;
  private prevTR: number;
  private trueRange: TrueRange;

  constructor({ period }: IndicatorRegistry['PlusDI']['input']) {
    super('PlusDI', null);
    this.age = 0;
    this.period = period;
    this.plusDM = new PlusDM({ period });
    this.prevTR = 0;
    this.trueRange = new TrueRange();
  }

  public onNewCandle(candle: Candle): void {
    this.trueRange.onNewCandle(candle);
    this.plusDM.onNewCandle(candle);

    const trueRange = this.trueRange.getResult() ?? 0;

    // Warm-up phase: accumulate values until we have enough candles.
    if (this.age < this.period) {
      this.prevTR += trueRange;
      this.age++;
      return;
    }

    const baseTR = Big(this.prevTR).minus(Big(this.prevTR).div(this.period));
    const newTR = +baseTR.plus(trueRange);
    const newPlusDM = this.plusDM.getResult() ?? 0;

    this.result = newTR === 0 ? 0 : +Big(100).times(Big(newPlusDM).div(newTR));
    this.prevTR = newTR;
  }

  public getResult(): number | null {
    return this.result;
  }
}
