import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { EMA } from '../ema/ema.indicator';

export class DEMA extends Indicator<'DEMA'> {
  private inner: EMA;
  private outer: EMA;

  constructor({ period, src }: IndicatorRegistry['DEMA']['input']) {
    super();

    // src goes to the first EMA only: the second smooths the first, fed to it as the close of a made-up candle. The DEMA used to
    // drop src and average the close
    this.inner = new EMA({ period, src });
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
}
