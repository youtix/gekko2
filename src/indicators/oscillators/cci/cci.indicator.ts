import { Indicator } from '@indicators/indicator';
import { checkInteger } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';
import { hlc3 } from '@utils/candle/candle.utils';
import { RingBuffer } from '@utils/collection/ringBuffer';
import { compareWithTolerance } from '@utils/math/math.utils';
import { map, sum } from 'lodash-es';

/**
 * TA-Lib's CCI: how far the typical price is from its mean over period, in units of 0.015 × their mean deviation, from candle period
 * on. A flat window gives 0, flat meaning that its typical prices are equal within the tolerance of compareWithTolerance.
 */
export class CCI extends Indicator<'CCI'> {
  private ringBuffer: RingBuffer<Candle>;
  private period: number;

  /** @param period - Candles of the mean and of the mean deviation of the typical price: a whole number, at least 2. Default 14 */
  constructor({ period = 14 }: IndicatorRegistry['CCI']['input'] = {}) {
    super();
    checkInteger('CCI', 'period', period, 2, 'the CCI of a single candle is always 0');
    this.ringBuffer = new RingBuffer(period);
    this.period = period;
  }

  public onNewCandle(candle: Candle): void {
    // Warmup phase
    this.ringBuffer.push(candle);
    if (!this.ringBuffer.isFull()) return;

    const price = map(this.ringBuffer.toArray(), hlc3);
    // A flat window used to give ±66.67 with a random sign instead of 0: its mean, summed in floating point, lands a few ulps off the
    // price, and the mean deviation was that residue. Flatness is now read on the typical prices, within the tolerance: a candle that
    // traded a tick either side of a flat price and closed on it has that typical price in exact arithmetic, not always in floating point
    if (compareWithTolerance(Math.max(...price), Math.min(...price)) === 0) {
      this.result = 0;
      return;
    }

    const mean = sum(price) / this.period;
    const devSum = price.reduce((acc, v) => Math.abs(v - mean) + acc, 0);
    const denom = (devSum / this.period) * 0.015;
    this.result = (price[this.period - 1] - mean) / denom;
  }
}
