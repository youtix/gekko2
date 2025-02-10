import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';

export class TrueRange extends Indicator<'TrueRange'> {
  private prevCandle?: Candle;

  constructor() {
    super('TrueRange', null);
  }

  public onNewCandle(candle: Candle): void {
    // If there is no previous candle, store the current candle and wait for the next one.
    if (!this.prevCandle) {
      this.prevCandle = candle;
      return;
    }

    // Convert current high, low and previous close to Big for precise arithmetic.
    const currentHigh = Big(candle.high);
    const currentLow = Big(candle.low);
    const prevClose = Big(this.prevCandle.close);

    // Calculate the three components:
    const range1 = currentHigh.minus(currentLow);
    const range2 = currentHigh.minus(prevClose).abs();
    const range3 = currentLow.minus(prevClose).abs();

    // Determine the true range as the maximum of the three values.
    let greatest = range1;
    if (range2.gt(greatest)) greatest = range2;
    if (range3.gt(greatest)) greatest = range3;

    // Set the indicator result.
    this.result = +greatest;

    // Update the previous candle for the next computation.
    this.prevCandle = candle;
  }

  public getResult() {
    return this.result;
  }
}
