import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import { sum } from '@utils/math/math.utils';
import Big from 'big.js';
import { map } from 'lodash-es';

export class CCI extends Indicator<'CCI'> {
  private fifoCandle: Candle[];
  private period: number;
  private age: number;

  constructor({ period }: IndicatorRegistry['CCI']['input'] = { period: 14 }) {
    super('CCI', null);
    this.period = period;
    this.fifoCandle = [];
    this.age = 0;
  }

  public onNewCandle(candle: Candle): void {
    // Warmup phase: collect enough data
    if (this.age < this.period) {
      this.fifoCandle = [...this.fifoCandle, candle];
      this.age++;
      if (this.age === this.period) this.result = this.computeCCI();
      return;
    }

    // Rolling window update
    this.fifoCandle = [...this.fifoCandle.slice(1), candle];
    this.result = this.computeCCI();
  }

  private computeCCI() {
    const hlc3 = map(this.fifoCandle, ({ high, low, close }) => +Big(high).plus(low).plus(close).div(3));
    const mean = +Big(sum(hlc3)).div(this.period);
    const devSum = hlc3.reduce((acc, v) => +Big(v).minus(mean).abs().plus(acc), 0);
    const denom = +Big(devSum).div(this.period).times(0.015);
    if (denom === 0) return 0;
    return +Big(hlc3[this.period - 1])
      .minus(mean)
      .div(denom);
  }

  public getResult() {
    return this.result;
  }
}
