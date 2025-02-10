import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';
import { MinusDI } from '../minusDI/minusDI.indicator';
import { PlusDI } from '../plusDI/plusDI.indicator';

export class DX extends Indicator<'DX'> {
  private age: number;
  private minusDI: MinusDI;
  private period: number;
  private plusDI: PlusDI;

  constructor({ period }: IndicatorRegistry['DX']['input']) {
    super('DX', null);
    this.age = 0;
    this.minusDI = new MinusDI({ period });
    this.period = period;
    this.plusDI = new PlusDI({ period });
  }

  public onNewCandle(candle: Candle): void {
    this.minusDI.onNewCandle(candle);
    this.plusDI.onNewCandle(candle);

    // Warm-up phase: accumulate values until we have enough candles.
    if (this.age < this.period) {
      this.age++;
      return;
    }

    const minusDI = this.minusDI.getResult() ?? 0;
    const plusDI = this.plusDI.getResult() ?? 0;

    // DX = 100 * (abs(minusDI - plusDI) / (minusDI + plusDI))
    const sumDI = +Big(minusDI).plus(plusDI);
    this.result = sumDI === 0 ? 0 : +Big(100).times(Big(minusDI).minus(plusDI).abs()).div(sumDI);
  }

  public getResult(): number | null {
    return this.result;
  }
}
