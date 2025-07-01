import { Candle } from '@models/types/candle.types';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';

export class OBV extends Indicator<'OBV'> {
  private prevClose?: number;
  private obv: number;

  constructor() {
    super('OBV', null);
    this.obv = 0;
  }

  public onNewCandle(candle: Candle): void {
    if (isNil(this.prevClose)) {
      this.prevClose = candle.close;
      return;
    }

    if (candle.close > this.prevClose) this.obv += candle.volume;
    else if (candle.close < this.prevClose) this.obv -= candle.volume;

    this.prevClose = candle.close;
    this.result = this.obv;
  }

  public getResult() {
    return this.result;
  }
}
