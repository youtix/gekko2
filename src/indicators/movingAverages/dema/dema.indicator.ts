import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { EMA } from '../ema/ema.indicator';

export class DEMA extends Indicator<'DEMA'> {
  private inner: EMA;
  private outer: EMA;

  constructor({ weight }: IndicatorRegistry['DEMA']['input']) {
    super('DEMA', NaN);

    this.inner = new EMA({ weight });
    this.outer = new EMA({ weight });
  }

  public onNewCandle(candle: Candle) {
    this.inner.onNewCandle(candle);
    this.outer.onNewCandle({ close: this.inner.getResult() } as Candle);
    this.result = +Big(2).mul(this.inner.getResult()).minus(this.outer.getResult());
  }

  public getResult() {
    return this.result;
  }
}
