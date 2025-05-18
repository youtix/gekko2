import { Indicator } from '@indicators/indicator';
import { MovingAverageClasses } from '@indicators/indicator.types';
import { DEMA } from '@indicators/movingAverages/dema/dema.indicator';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { SMA } from '@indicators/movingAverages/sma/sma.indicator';
import { WMA } from '@indicators/movingAverages/wma/wma.indicator';
import { Candle } from '@models/types/candle.types';
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
  private window: number[];

  constructor(
    { period = 5, stdevUp = 2, stdevDown = 2, maType = 'sma' }: IndicatorRegistry['BollingerBands']['input'] = {
      period: 5,
      stdevUp: 2,
      stdevDown: 2,
      maType: 'sma',
    },
  ) {
    super('BollingerBands', { upper: null, middle: null, lower: null });
    this.period = period;
    this.stdevUp = stdevUp;
    this.stdevDown = stdevDown;
    this.ma = new MOVING_AVERAGES[maType]({ period });
    this.window = [];
  }

  public onNewCandle({ close }: Candle): void {
    // Update moving average
    this.ma.onNewCandle({ close } as Candle);

    // Build rolling window of closes
    this.window.push(close);
    if (this.window.length > this.period) this.window.shift();

    const middle = this.ma.getResult();
    if (!middle) return;

    // Compute standard deviation: sqrt(sum((x - mean)^2)/period)
    const standardDeviation = stdev(this.window);

    // Upper and Lower Bands
    const upper = middle + this.stdevUp * standardDeviation;
    const lower = middle - this.stdevDown * standardDeviation;

    this.result = { upper, middle, lower };
  }

  public getResult() {
    return this.result;
  }
}
