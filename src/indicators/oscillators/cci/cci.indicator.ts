import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/candle.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import { hlc3 } from '@utils/candle/candle.utils';
import { map, sum } from 'lodash-es';

export class CCI extends Indicator<'CCI'> {
  private ringBuffer: RingBuffer<Candle>;
  private period: number;

  constructor({ period = 14 }: IndicatorRegistry['CCI']['input'] = {}) {
    super('CCI', null);
    this.ringBuffer = new RingBuffer(period);
    this.period = period;
  }

  public onNewCandle(candle: Candle): void {
    // Warmup phase
    this.ringBuffer.push(candle);
    if (!this.ringBuffer.isFull()) return;

    const price = map(this.ringBuffer.toArray(), hlc3);
    const mean = sum(price) / this.period;
    const devSum = price.reduce((acc, v) => Math.abs(v - mean) + acc, 0);
    const denom = (devSum / this.period) * 0.015;
    this.result = denom === 0 ? 0 : (price[this.period - 1] - mean) / denom;
  }

  public getResult() {
    return this.result;
  }
}
