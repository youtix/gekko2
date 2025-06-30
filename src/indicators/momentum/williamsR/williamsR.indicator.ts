import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import { RingBuffer } from '@utils/array/ringBuffer';

export class WilliamsR extends Indicator<'WilliamsR'> {
  private ringBufferHigh: RingBuffer<number>;
  private ringBufferLow: RingBuffer<number>;
  private ringBufferClose: RingBuffer<number>;

  constructor({ period = 14 }: IndicatorRegistry['WilliamsR']['input'] = {}) {
    super('WilliamsR', null);
    this.ringBufferHigh = new RingBuffer(period);
    this.ringBufferLow = new RingBuffer(period);
    this.ringBufferClose = new RingBuffer(period);
  }

  public onNewCandle({ high, low, close }: Candle): void {
    this.ringBufferHigh.push(high);
    this.ringBufferLow.push(low);
    this.ringBufferClose.push(close);

    // Warmup phase
    if (!this.ringBufferClose.isFull()) return;

    const highest = this.ringBufferHigh.max();
    const lowest = this.ringBufferLow.min();
    const lastClose = this.ringBufferClose.last();
    // Williams %R = (Close - HighestHigh) / (HighestHigh - LowestLow) * 100
    this.result = highest === lowest ? 0 : ((lastClose - highest) / (highest - lowest)) * 100;
  }

  public getResult() {
    return this.result;
  }
}
