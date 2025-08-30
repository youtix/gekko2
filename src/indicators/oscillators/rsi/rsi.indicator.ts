import { Indicator } from '@indicators/indicator';
import { INPUT_SOURCES } from '@indicators/indicator.const';
import { WilderSmoothing } from '@indicators/movingAverages/wilderSmoothing/wilderSmoothing.indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';

export class RSI extends Indicator<'RSI'> {
  private wilderGain: WilderSmoothing;
  private wilderLoss: WilderSmoothing;
  private prevPrice?: number;
  private getPrice: (candle: Candle) => number;

  constructor({ period = 14, src = 'close' }: IndicatorRegistry['RSI']['input'] = {}) {
    super('RSI', null);
    this.wilderGain = new WilderSmoothing({ period });
    this.wilderLoss = new WilderSmoothing({ period });
    this.getPrice = INPUT_SOURCES[src];
  }

  public onNewCandle(candle: Candle): void {
    const price = this.getPrice(candle);
    if (isNil(this.prevPrice)) {
      this.prevPrice = price;
      return;
    }

    const change = price - this.prevPrice;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    this.wilderGain.onNewCandle({ close: gain } as Candle);
    this.wilderLoss.onNewCandle({ close: loss } as Candle);

    const avgGain = this.wilderGain.getResult();
    const avgLoss = this.wilderLoss.getResult();

    if (!isNil(avgGain) && !isNil(avgLoss)) {
      const total = avgGain + avgLoss;
      this.result = total === 0 ? 0 : (avgGain / total) * 100;
    }

    this.prevPrice = price;
  }

  public getResult() {
    return this.result;
  }
}
