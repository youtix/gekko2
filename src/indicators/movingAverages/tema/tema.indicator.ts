import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';
import { EMA } from '../ema/ema.indicator';

export class TEMA extends Indicator<'TEMA'> {
  private ema1: EMA;
  private ema2: EMA;
  private ema3: EMA;

  constructor({ period }: IndicatorRegistry['TEMA']['input']) {
    super('TEMA', null);

    this.ema1 = new EMA({ period });
    this.ema2 = new EMA({ period });
    this.ema3 = new EMA({ period });
  }

  public onNewCandle(candle: Candle) {
    // First EMA
    this.ema1.onNewCandle(candle);
    const e1 = this.ema1.getResult();
    if (isNil(e1)) return;

    // Second EMA
    this.ema2.onNewCandle({ close: e1 } as Candle);
    const e2 = this.ema2.getResult();
    if (isNil(e2)) return;

    // Third EMA
    this.ema3.onNewCandle({ close: e2 } as Candle);
    const e3 = this.ema3.getResult();
    if (isNil(e3)) return;

    this.result = 3 * e1 - 3 * e2 + e3;
  }

  public getResult() {
    return this.result;
  }
}
