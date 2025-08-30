import { Indicator } from '@indicators/indicator';
import { MovingAverageClasses } from '@indicators/indicator.types';
import { DEMA } from '@indicators/movingAverages/dema/dema.indicator';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { SMA } from '@indicators/movingAverages/sma/sma.indicator';
import { WMA } from '@indicators/movingAverages/wma/wma.indicator';
import { Candle } from '@models/candle.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import { stdev } from '@utils/math/math.utils';

const MOVING_AVERAGES = {
  sma: SMA,
  ema: EMA,
  dema: DEMA,
  wma: WMA,
} as const;

export class BollingerBands extends Indicator<'BollingerBands'> {
  private period: number;
  private stdevUp: number;
  private stdevDown: number;
  private ma: MovingAverageClasses;
  private ringBuffer: RingBuffer<number>;

  constructor({
    period = 5,
    stdevUp = 2,
    stdevDown = 2,
    maType = 'sma',
  }: IndicatorRegistry['BollingerBands']['input'] = {}) {
    super('BollingerBands', { upper: null, middle: null, lower: null });
    this.period = period;
    this.stdevUp = stdevUp;
    this.stdevDown = stdevDown;
    this.ma = new MOVING_AVERAGES[maType]({ period });
    this.ringBuffer = new RingBuffer(period);
  }

  public onNewCandle({ close }: Candle): void {
    //  Warmup phase
    this.ma.onNewCandle({ close } as Candle);
    this.ringBuffer.push(close);
    if (!this.ringBuffer.isFull()) return;

    const middle = this.ma.getResult();
    if (!middle) return;

    // Compute standard deviation
    const standardDeviation = stdev(this.ringBuffer.toArray());

    // Upper and Lower Bands
    const upper = middle + this.stdevUp * standardDeviation;
    const lower = middle - this.stdevDown * standardDeviation;

    this.result = { upper, middle, lower };
  }

  public getResult() {
    return this.result;
  }
}
