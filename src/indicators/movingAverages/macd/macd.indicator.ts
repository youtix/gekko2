import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { Indicator } from '../../indicator';
import { EMA } from '../ema/ema.indicator';

export class MACD extends Indicator<'MACD'> {
  private short: EMA;
  private long: EMA;
  private signal: EMA;

  constructor({ short, long, signal }: IndicatorRegistry['MACD']['input']) {
    super('MACD', NaN);
    this.short = new EMA({ weight: short });
    this.long = new EMA({ weight: long });
    this.signal = new EMA({ weight: signal });
  }

  public onNewCandle(candle: Candle): void {
    this.short.onNewCandle(candle);
    this.long.onNewCandle(candle);
    const shortResult = this.short.getResult();
    const longResult = this.long.getResult();
    const diff = Big(shortResult).minus(longResult);
    this.signal.onNewCandle({ close: +diff } as Candle);
    const signalResult = this.signal.getResult();
    this.result = +diff.minus(signalResult);
  }

  public getResult() {
    return this.result;
  }
}
