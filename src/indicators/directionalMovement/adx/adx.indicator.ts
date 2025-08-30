import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/candle.types';
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
      this.sumDX += dx;
      this.age++;
      if (this.age === this.period) {
        this.result = this.sumDX / this.period;
        this.prevADX = this.result;
      }
      return;
    }

    this.result = (this.prevADX * (this.period - 1) + dx) / this.period;

    this.prevADX = this.result;
  }

  public getResult() {
    return this.result;
  }
}
