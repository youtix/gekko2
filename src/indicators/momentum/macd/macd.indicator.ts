import { EMA } from '@indicators/movingAverages';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { isNil } from 'lodash-es';
import { Indicator } from '../../indicator';

export class MACD extends Indicator<'MACD'> {
  private short: EMA;
  private long: EMA;
  private signal: EMA;

  constructor({ short, long, signal }: IndicatorRegistry['MACD']['input']) {
    super('MACD', 0);
    this.short = new EMA({ period: short });
    this.long = new EMA({ period: long });
    this.signal = new EMA({ period: signal });
  }

  public onNewCandle(candle: Candle): void {
    this.short.onNewCandle(candle);
    this.long.onNewCandle(candle);
    const shortResult = this.short.getResult();
    const longResult = this.long.getResult();
    if (!isNil(shortResult) && !isNil(longResult)) {
      const diff = Big(shortResult).minus(longResult);
      this.signal.onNewCandle({ close: +diff } as Candle);
      const signalResult = this.signal.getResult();
      if (!isNil(signalResult)) this.result = +diff.minus(signalResult);
    }
  }

  public getResult() {
    return this.result;
  }
}
