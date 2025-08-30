import { Indicator } from '@indicators/indicator';
import { EMA } from '@indicators/movingAverages/ema/ema.indicator';
import { Candle } from '@models/candle.types';
import { isNil } from 'lodash-es';
import { ROC } from '../roc/roc.indicator';

export class TRIX extends Indicator<'TRIX'> {
  private ema1: EMA;
  private ema2: EMA;
  private ema3: EMA;
  private roc: ROC;

  constructor({ period = 30 }: IndicatorRegistry['TRIX']['input'] = {}) {
    super('TRIX', null);
    this.ema1 = new EMA({ period });
    this.ema2 = new EMA({ period });
    this.ema3 = new EMA({ period });
    this.roc = new ROC({ period: 1 });
  }

  public onNewCandle(candle: Candle): void {
    this.ema1.onNewCandle(candle);
    const ema1Result = this.ema1.getResult();
    if (isNil(ema1Result)) return;

    this.ema2.onNewCandle({ close: ema1Result } as Candle);
    const ema2Result = this.ema2.getResult();
    if (isNil(ema2Result)) return;

    this.ema3.onNewCandle({ close: ema2Result } as Candle);
    const ema3Result = this.ema3.getResult();
    if (isNil(ema3Result)) return;

    this.roc.onNewCandle({ close: ema3Result } as Candle);
    this.result = this.roc.getResult();
  }

  public getResult() {
    return this.result;
  }
}
