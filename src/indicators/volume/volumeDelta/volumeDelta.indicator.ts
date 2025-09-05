import { MACD } from '@indicators/momentum/macd/macd.indicator';
import { Candle } from '@models/candle.types';
import { Indicator } from '../../indicator';

export class VolumeDelta extends Indicator<'VolumeDelta'> {
  private src: 'quote' | 'base';
  private macd: MACD;

  constructor({ src = 'quote', short = 12, long = 26, signal = 9 }: IndicatorRegistry['VolumeDelta']['input'] = {}) {
    super('VolumeDelta', null);
    this.src = src;
    this.macd = new MACD({ short, long, signal });
  }

  public onNewCandle(candle: Candle): void {
    const total = this.src === 'quote' ? (candle.quoteVolume ?? 0) : (candle.volume ?? 0);
    const active = this.src === 'quote' ? (candle.quoteVolumeActive ?? 0) : (candle.volumeActive ?? 0);
    const volumeDelta = active - (total - active);

    this.macd.onNewCandle({ close: volumeDelta } as Candle);
    const macdResult = this.macd.getResult();

    this.result = { volumeDelta, ...macdResult };
  }

  public getResult() {
    return this.result;
  }
}
