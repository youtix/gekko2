import { Indicator } from '@indicators/indicator';
import { checkInteger } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';
import { RingBuffer } from '@utils/collection/ringBuffer';

export class WilliamsR extends Indicator<'WilliamsR'> {
  private ringBufferHigh: RingBuffer<number>;
  private ringBufferLow: RingBuffer<number>;
  private ringBufferClose: RingBuffer<number>;

  /** @param period - Candles of the range the close is placed in: a whole number, at least 1. Default 14 */
  constructor({ period = 14 }: IndicatorRegistry['WilliamsR']['input'] = {}) {
    super();
    checkInteger('WilliamsR', 'period', period);
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
}
