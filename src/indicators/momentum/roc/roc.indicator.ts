import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import Big from 'big.js';

export class ROC extends Indicator<'ROC'> {
  private ringBuffer: RingBuffer<number>;

  constructor({ period }: IndicatorRegistry['ROC']['input']) {
    super('ROC', null);
    this.ringBuffer = new RingBuffer(period);
  }

  public onNewCandle({ close }: Candle): void {
    // Warmup phase
    const oldest = this.ringBuffer.first();
    this.ringBuffer.push(close);
    if (!this.ringBuffer.isFull()) return;

    this.result =
      oldest === 0
        ? 0
        : +Big(close)
            .div(oldest ?? close)
            .minus(1)
            .times(100);
  }

  public getResult() {
    return this.result;
  }
}
