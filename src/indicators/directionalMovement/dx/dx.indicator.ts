import { Indicator } from '@indicators/indicator';
import { checkInteger } from '@indicators/indicator.utils';
import { Candle } from '@models/candle.types';
import { MinusDI } from '../minusDI/minusDI.indicator';
import { PlusDI } from '../plusDI/plusDI.indicator';

export class DX extends Indicator<'DX'> {
  private age: number;
  private minusDI: MinusDI;
  private period: number;
  private plusDI: PlusDI;

  /** @param period - Period of the two directional indicators: a whole number, at least 2. Required */
  constructor({ period }: IndicatorRegistry['DX']['input']) {
    super();
    // With period 1 one of the two DIs is always 0, so DX was 100 on a candle with directional movement and 0 on any other, an inside
    // candle included. TA-Lib's minimum is 2 as well
    checkInteger('DX', 'period', period, 2, 'the DX of a single candle is 100, or 0/0 when it has no directional movement');
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
    const sumDI = minusDI + plusDI;
    this.result = sumDI === 0 ? 0 : (100 * Math.abs(minusDI - plusDI)) / sumDI;
  }
}
