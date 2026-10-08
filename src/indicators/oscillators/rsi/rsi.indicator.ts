import { Indicator } from '@indicators/indicator';
import { checkInputSource, checkInteger, getInputSource } from '@indicators/indicator.utils';
import { WilderSmoothing } from '@indicators/movingAverages/wilderSmoothing/wilderSmoothing.indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';

export class RSI extends Indicator<'RSI'> {
  private wilderGain: WilderSmoothing;
  private wilderLoss: WilderSmoothing;
  private prevPrice?: number;
  private getPrice: (candle: Candle) => number;

  /**
   * @param period - Period of the smoothed gains and losses: a whole number, at least 1. Default 14
   * @param src - Price read from each candle: open, high, low, close, hl2, hlc3 or ohlc4. Default close
   */
  constructor({ period = 14, src }: IndicatorRegistry['RSI']['input'] = {}) {
    super();
    checkInteger('RSI', 'period', period);
    checkInputSource('RSI', src);
    this.wilderGain = new WilderSmoothing({ period });
    this.wilderLoss = new WilderSmoothing({ period });
    this.getPrice = getInputSource(src);
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
}
