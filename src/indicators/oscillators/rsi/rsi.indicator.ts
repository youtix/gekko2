import { Indicator } from '@indicators/indicator';
import { WilderSmoothing } from '@indicators/movingAverages';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { isNil } from 'lodash-es';

export class RSI extends Indicator<'RSI'> {
  private wilderGain: WilderSmoothing;
  private wilderLoss: WilderSmoothing;
  private prevClose?: number;

  constructor({ period }: IndicatorRegistry['RSI']['input'] = { period: 14 }) {
    super('RSI', null);
    this.wilderGain = new WilderSmoothing({ period });
    this.wilderLoss = new WilderSmoothing({ period });
  }

  public onNewCandle({ close }: Candle): void {
    if (isNil(this.prevClose)) {
      this.prevClose = close;
      return;
    }

    const change = +Big(close).minus(this.prevClose);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    this.wilderGain.onNewCandle({ close: gain } as Candle);
    this.wilderLoss.onNewCandle({ close: loss } as Candle);

    const avgGain = this.wilderGain.getResult();
    const avgLoss = this.wilderLoss.getResult();

    if (!isNil(avgGain) && !isNil(avgLoss)) {
      const total = +Big(avgGain).plus(avgLoss);
      this.result = total === 0 ? 0 : +Big(avgGain).div(total).times(100);
    }

    this.prevClose = close;
  }

  public getResult() {
    return this.result;
  }
}
