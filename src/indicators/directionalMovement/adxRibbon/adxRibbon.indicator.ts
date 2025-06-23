import { Candle } from '@models/types/candle.types';
import { isNumber } from 'lodash-es';
import { Indicator } from '../../indicator';
import { ADX } from '../adx/adx.indicator';

export class ADXRibbon extends Indicator<'ADXRibbon'> {
  private adxs: ADX[] = [];

  constructor({ count = 19, start = 12, step = 3 }: IndicatorRegistry['ADXRibbon']['input'] = {}) {
    super('ADXRibbon', null);
    for (let i = 0; i < count; i++) this.adxs.push(new ADX({ period: start + i * step }));
  }

  public onNewCandle(candle: Candle): void {
    this.adxs.forEach((adx: ADX) => adx.onNewCandle(candle));
    const results = this.adxs.map((adx: ADX) => adx.getResult());
    if (!results.every<number>(isNumber)) return;

    this.result = { results, spread: Math.max(...results) - Math.min(...results) };
  }

  public getResult() {
    return this.result;
  }
}
