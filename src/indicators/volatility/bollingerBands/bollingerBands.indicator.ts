import { Indicator } from '@indicators/indicator';
import { MOVING_AVERAGE_TYPES } from '@indicators/indicator.const';
import { MovingAverageClasses } from '@indicators/indicator.types';
import { checkInteger, checkNumber, checkOneOf } from '@indicators/indicator.utils';
import { DEMA } from '@indicators/movingAverages/dema/dema.indicator';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { SMA } from '@indicators/movingAverages/sma/sma.indicator';
import { WMA } from '@indicators/movingAverages/wma/wma.indicator';
import { Candle } from '@models/candle.types';
import { RingBuffer } from '@utils/collection/ringBuffer';
import { stdev } from '@utils/math/math.utils';

const MOVING_AVERAGES = {
  sma: SMA,
  ema: EMA,
  dema: DEMA,
  wma: WMA,
} as const;

export class BollingerBands extends Indicator<'BollingerBands'> {
  private stdevUp: number;
  private stdevDown: number;
  private ma: MovingAverageClasses;
  private ringBuffer: RingBuffer<number>;

  /**
   * @param period - Candles of the middle band and of the deviation: a whole number, at least 2. Default 5
   * @param stdevUp - Deviations from the middle to the upper band: a number, at least 0. Default 2
   * @param stdevDown - Deviations from the middle to the lower band: a number, at least 0. Default 2
   * @param maType - Kind of moving average of the middle band: sma, ema, dema or wma. Default sma
   */
  constructor({ period = 5, stdevUp = 2, stdevDown = 2, maType = 'sma' }: IndicatorRegistry['BollingerBands']['input'] = {}) {
    super();
    checkInteger('BollingerBands', 'period', period, 2, 'the bands of a single candle are its close: its deviation is 0');
    // A negative multiplier put the band on the other side of the middle: upper below it, or lower above it
    checkNumber('BollingerBands', 'stdevUp', stdevUp, { atLeast: 0 });
    checkNumber('BollingerBands', 'stdevDown', stdevDown, { atLeast: 0 });
    checkOneOf('BollingerBands', 'maType', maType, MOVING_AVERAGE_TYPES);
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
}
