import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import { isNil } from 'lodash-es';
import { EMA } from '../ema/ema.indicator';

export class DEMA extends Indicator<'DEMA'> {
  private inner: EMA;
  private outer: EMA;

  constructor({ period }: IndicatorRegistry['DEMA']['input']) {
    super('DEMA', null);

    this.inner = new EMA({ period });
    this.outer = new EMA({ period });
  }

  public onNewCandle(candle: Candle) {
    this.inner.onNewCandle(candle);
    const innerRes = this.inner.getResult();
    if (!isNil(innerRes)) {
      this.outer.onNewCandle({ close: innerRes } as Candle);
      const outerRes = this.outer.getResult();
      if (!isNil(outerRes)) this.result = 2 * innerRes - outerRes;
    }
  }

  public getResult() {
    return this.result;
  }
}
