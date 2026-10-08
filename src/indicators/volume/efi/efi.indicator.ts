import { MovingAverageClasses } from '@indicators/indicator.types';
import { getInputSource } from '@indicators/indicator.utils';
import { DEMA } from '@indicators/movingAverages/dema/dema.indicator';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { SMA } from '@indicators/movingAverages/sma/sma.indicator';
import { WMA } from '@indicators/movingAverages/wma/wma.indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';

const MOVING_AVERAGES = {
  sma: SMA,
  ema: EMA,
  dema: DEMA,
  wma: WMA,
} as const;

/** Elder's force index: the change of the src price times the volume (fi), and its maType moving average over period (smoothed) */
export class EFI extends Indicator<'EFI'> {
  private ma: MovingAverageClasses;
  private prevPrice?: number;
  private getPrice: (candle: Candle) => number;

  constructor({ period = 13, maType = 'ema', src }: IndicatorRegistry['EFI']['input'] = {}) {
    super();
    // The average gets the force as the close of a made-up candle, so it reads the close whatever src says. It used to get src
    // too: with sma or ema and any src but close it read a field that candle lacks, and smoothed was NaN forever
    this.ma = new MOVING_AVERAGES[maType]({ period, src: 'close' });
    this.getPrice = getInputSource(src);
  }

  public onNewCandle(candle: Candle): void {
    // The force used to take the close whatever src said
    const price = this.getPrice(candle);
    if (isNil(this.prevPrice)) {
      this.prevPrice = price;
      return;
    }

    const fi = (price - this.prevPrice) * candle.volume;
    this.prevPrice = price;

    this.ma.onNewCandle({ close: fi } as Candle);
    const smoothed = this.ma.getResult();

    // The force index alone went out while its moving average warmed up
    if (!isNil(smoothed)) this.result = { fi, smoothed };
  }
}
