import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { isNil } from 'lodash-es';
import { DX } from '../dx/dx.indicator';

export class ADX extends Indicator<'ADX'> {
  private dx: DX;
  private period: number;
  private age: number;
  private prevADX: number;
  private sumDX: number;

  constructor({ period }: IndicatorRegistry['ADX']['input']) {
    super('ADX', null);
    this.dx = new DX({ period });
    this.period = period;
    this.age = 0;
    this.sumDX = 0;
    this.prevADX = 0;
  }

  public onNewCandle(candle: Candle): void {
    // update indicators
    this.dx.onNewCandle(candle);
    const dx = this.dx.getResult();

    // Warmup
    if (isNil(dx)) return;
    if (this.age < this.period) {
      this.sumDX = +Big(this.sumDX).plus(dx);
      this.age++;
      if (this.age === this.period) {
        this.result = +Big(this.sumDX).div(this.period);
        this.prevADX = this.result;
      }
      return;
    }

    this.result = +Big(this.prevADX)
      .times(this.period - 1)
      .plus(dx)
      .div(this.period);

    this.prevADX = this.result;
  }

  public getResult() {
    return this.result;
  }
}
