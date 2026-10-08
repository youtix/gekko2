import { Indicator } from '@indicators/indicator';
import { checkInputSource, checkInteger } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { EMA } from '../ema/ema.indicator';

export class DEMA extends Indicator<'DEMA'> {
  private inner: EMA;
  private outer: EMA;

  /**
   * @param period - Period of both EMAs: a whole number, at least 1. Required
   * @param src - Price read from each candle: open, high, low, close, hl2, hlc3 or ohlc4. Default close
   */
  constructor({ period, src }: IndicatorRegistry['DEMA']['input']) {
    super();
    checkInteger('DEMA', 'period', period);
    checkInputSource('DEMA', src);

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
