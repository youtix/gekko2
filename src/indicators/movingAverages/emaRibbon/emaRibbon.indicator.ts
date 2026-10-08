import { checkInputSource, checkInteger } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';
import { isNumber } from 'lodash-es';
import { Indicator } from '../../indicator';
import { EMA } from '../ema/ema.indicator';

export class EMARibbon extends Indicator<'EMARibbon'> {
  private emas: EMA[] = [];

  /**
   * @param count - EMAs in the ribbon: a whole number, at least 1. Default 22
   * @param start - Period of the first EMA: a whole number, at least 1. Default 3
   * @param step - Period added from one EMA to the next: a whole number, at least 1. Default 3
   * @param src - Price read from each candle: open, high, low, close, hl2, hlc3 or ohlc4. Default close
   */
  constructor({ count = 22, start = 3, step = 3, src = 'close' }: IndicatorRegistry['EMARibbon']['input'] = {}) {
    super();
    // A count of 0 made a ribbon without EMAs, never null, whose spread was -Infinity; a fractional start or step gave EMAs that never
    // seeded
    checkInteger('EMARibbon', 'count', count);
    checkInteger('EMARibbon', 'start', start);
    checkInteger('EMARibbon', 'step', step);
    checkInputSource('EMARibbon', src);
    for (let i = 0; i < count; i++) this.emas.push(new EMA({ period: start + i * step, src }));
  }

  public onNewCandle(candle: Candle) {
    // One pass over the EMAs, which every candle used to go through with a closure, then scan again for numbers and spread twice
    const results: number[] = [];
    let highest = -Infinity;
    let lowest = Infinity;
    for (const ema of this.emas) {
      ema.onNewCandle(candle);
      const result = ema.getResult();
      if (!isNumber(result)) continue;
      results.push(result);
      highest = Math.max(highest, result);
      lowest = Math.min(lowest, result);
    }
    // Ready once every EMA is
    if (results.length < this.emas.length) return;

    this.result = { results, spread: highest - lowest };
  }
}
