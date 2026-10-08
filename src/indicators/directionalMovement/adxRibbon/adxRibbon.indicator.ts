import { checkInteger } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';
import { isNumber } from 'lodash-es';
import { Indicator } from '../../indicator';
import { ADX } from '../adx/adx.indicator';

export class ADXRibbon extends Indicator<'ADXRibbon'> {
  private adxs: ADX[] = [];

  /**
   * @param count - ADXs in the ribbon: a whole number, at least 1. Default 19
   * @param start - Period of the first ADX: a whole number, at least 1. Default 12
   * @param step - Period added from one ADX to the next: a whole number, at least 1. Default 3
   */
  constructor({ count = 19, start = 12, step = 3 }: IndicatorRegistry['ADXRibbon']['input'] = {}) {
    super();
    // A count of 0 made a ribbon without ADXs, never null, whose spread was -Infinity
    checkInteger('ADXRibbon', 'count', count);
    checkInteger('ADXRibbon', 'start', start);
    checkInteger('ADXRibbon', 'step', step);
    for (let i = 0; i < count; i++) this.adxs.push(new ADX({ period: start + i * step }));
  }

  public onNewCandle(candle: Candle): void {
    this.adxs.forEach((adx: ADX) => adx.onNewCandle(candle));
    const results = this.adxs.map((adx: ADX) => adx.getResult());
    if (!results.every<number>(isNumber)) return;

    this.result = { results, spread: Math.max(...results) - Math.min(...results) };
  }
}
