import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import { hlc3 } from '@utils/candle/candle.utils';
import { sum } from '@utils/math/math.utils';
import Big from 'big.js';
import { map } from 'lodash-es';

export class CCI extends Indicator<'CCI'> {
  private ringBuffer: RingBuffer<Candle>;
  private period: number;

  constructor({ period }: IndicatorRegistry['CCI']['input'] = { period: 14 }) {
    super('CCI', null);
    this.ringBuffer = new RingBuffer(period);
    this.period = period;
  }

  public onNewCandle(candle: Candle): void {
    // Warmup phase
    this.ringBuffer.push(candle);
    if (!this.ringBuffer.isFull()) return;

    const price = map(this.ringBuffer.toArray(), hlc3);
    const mean = +Big(sum(price)).div(this.period);
    const devSum = price.reduce((acc, v) => +Big(v).minus(mean).abs().plus(acc), 0);
    const denom = +Big(devSum).div(this.period).times(0.015);
    this.result =
      denom === 0
        ? 0
        : +Big(price[this.period - 1])
            .minus(mean)
            .div(denom);
  }

  public getResult() {
    return this.result;
  }
}
