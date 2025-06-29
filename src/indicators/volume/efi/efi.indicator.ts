import { MovingAverageClasses } from '@indicators/indicator.types';
import { DEMA } from '@indicators/movingAverages/dema/dema.indicator';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { SMA } from '@indicators/movingAverages/sma/sma.indicator';
import { WMA } from '@indicators/movingAverages/wma/wma.indicator';
import { Candle } from '@models/types/candle.types';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';

const MOVING_AVERAGES = {
  sma: SMA,
  ema: EMA,
  dema: DEMA,
  wma: WMA,
} as const;

export class EFI extends Indicator<'EFI'> {
  private ma: MovingAverageClasses;
  private prevClose?: number;

  constructor({ period = 13, maType = 'ema', src = 'close' }: IndicatorRegistry['EFI']['input'] = {}) {
    super('EFI', { fi: null, smoothed: null });
    this.ma = new MOVING_AVERAGES[maType]({ period, src });
  }

  public onNewCandle(candle: Candle): void {
    if (isNil(this.prevClose)) {
      this.prevClose = candle.close;
      return;
    }

    const fi = (candle.close - this.prevClose) * candle.volume;
    this.prevClose = candle.close;

    this.ma.onNewCandle({ close: fi } as Candle);
    const smoothed = this.ma.getResult();

    this.result = { fi, smoothed };
  }

  public getResult() {
    return this.result;
  }
}
