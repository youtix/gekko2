import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { WilderSmoothing } from '../../movingAverages/wilderSmoothing/wilderSmoothing.indicator';
import { TrueRange } from '../trueRange/trueRange.indicator';

export class ATR extends Indicator<'ATR'> {
  private period: number;
  private truerange: TrueRange;
  private smoothing: WilderSmoothing;

  constructor({ period }: IndicatorRegistry['ATR']['input']) {
    super('ATR', null);
    this.period = period;
    this.truerange = new TrueRange();
    this.smoothing = new WilderSmoothing({ period: this.period });
  }

  public onNewCandle(candle: Candle): void {
    this.truerange.onNewCandle(candle);
    const tr = this.truerange.getResult();
    if (isNil(tr)) return;

    this.smoothing.onNewCandle({ close: tr } as Candle);
    this.result = this.smoothing.getResult();
  }

  public getResult() {
    return this.result;
  }
}
