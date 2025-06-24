import { Candle } from '@models/types/candle.types';
import { isNumber } from 'lodash-es';
import { Indicator } from '../../indicator';
import { EMA } from '../ema/ema.indicator';

export class EMARibbon extends Indicator<'EMARibbon'> {
  private emas: EMA[] = [];

  constructor({ count = 22, start = 3, step = 3, src = 'close' }: IndicatorRegistry['EMARibbon']['input'] = {}) {
    super('EMARibbon', null);
    for (let i = 0; i < count; i++) this.emas.push(new EMA({ period: start + i * step, src }));
  }

  public onNewCandle(candle: Candle) {
    this.emas.forEach((ema: EMA) => ema.onNewCandle(candle));
    const results = this.emas.map((ema: EMA) => ema.getResult());
    if (!results.every<number>(isNumber)) return;

    this.result = {
      results,
      spread: Math.max(...results) - Math.min(...results),
    };
  }

  public getResult() {
    return this.result;
  }
}
