import { Indicator } from '@indicators/indicator';
import { SMA } from '@indicators/movingAverages/sma/sma.indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { isNil } from 'lodash-es';

export class AO extends Indicator<'AO'> {
  private smaFast: SMA;
  private smaSlow: SMA;

  constructor({ short, long }: IndicatorRegistry['AO']['input'] = { short: 5, long: 34 }) {
    super('AO', null);
    this.smaFast = new SMA({ period: short });
    this.smaSlow = new SMA({ period: long });
  }

  public onNewCandle({ high, low }: Candle): void {
    // Typical price: midpoint of the bar
    const hl2 = +Big(high).plus(low).div(2);

    // Update fast and slow SMAs
    this.smaFast.onNewCandle({ close: hl2 } as Candle);
    this.smaSlow.onNewCandle({ close: hl2 } as Candle);

    const fastValue = this.smaFast.getResult();
    const slowValue = this.smaSlow.getResult();

    if (isNil(fastValue) || isNil(slowValue)) return;
    this.result = fastValue - slowValue;
  }

  public getResult() {
    return this.result;
  }
}
