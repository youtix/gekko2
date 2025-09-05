import { Candle } from '@models/candle.types';
import { Indicator } from '../../indicator';

export class CVD extends Indicator<'CVD'> {
  private source: 'quote' | 'base';

  constructor({ source = 'quote' }: IndicatorRegistry['CVD']['input'] = {}) {
    super('CVD', null);
    this.source = source;
  }

  public onNewCandle(candle: Candle): void {
    const total = this.source === 'quote' ? (candle.quoteVolume ?? 0) : (candle.volume ?? 0);
    const active = this.source === 'quote' ? (candle.quoteVolumeActive ?? 0) : (candle.volumeActive ?? 0);

    this.result = active - (total - active);
  }

  public getResult() {
    return this.result;
  }
}
