import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import { SMA } from '../sma/sma.indicator';

export class SMMA extends Indicator<'SMMA'> {
  private age: number;
  private period: number;
  private sma: SMA;

  constructor({ period }: IndicatorRegistry['SMMA']['input']) {
    super('SMMA', 0);
    this.sma = new SMA({ period });
    this.age = 0;
    this.period = period;
  }

  public onNewCandle(candle: Candle) {
    if (this.age < this.period - 1) {
      this.sma.onNewCandle(candle);
      this.age++;
      return;
    }

    if (this.age === this.period - 1) {
      this.sma.onNewCandle(candle);
      this.result = this.sma.getResult();
      this.age++;
      return;
    }

    this.result = ((this.period - 1) * (this.result ?? 0) + candle.close) / this.period;
  }

  public getResult() {
    return this.result;
  }
}
