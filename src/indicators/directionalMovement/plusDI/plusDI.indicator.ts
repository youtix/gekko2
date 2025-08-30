import { TrueRange } from '@indicators/volatility/trueRange/trueRange.indicator';
import { Candle } from '@models/candle.types';
import { Indicator } from '../../indicator';
import { PlusDM } from '../plusDM/plusDM.indicator';

export class PlusDI extends Indicator<'PlusDI'> {
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

    const baseTR = this.prevTR - this.prevTR / this.period;
    const newTR = baseTR + trueRange;
    const newPlusDM = this.plusDM.getResult() ?? 0;

    this.result = newTR === 0 ? 0 : (100 * newPlusDM) / newTR;
    this.prevTR = newTR;
  }

  public getResult() {
    return this.result;
  }
}
