import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';

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

    const currentHigh = candle.high;
    const currentLow = candle.low;
    const prevClose = this.prevCandle.close;

    // Calculate the three components:
    const range1 = currentHigh - currentLow;
    const range2 = Math.abs(currentHigh - prevClose);
    const range3 = Math.abs(currentLow - prevClose);

    // Determine the true range as the maximum of the three values.
    let greatest = range1;
    if (range2 > greatest) greatest = range2;
    if (range3 > greatest) greatest = range3;

    // Set the indicator result.
    this.result = greatest;

    // Update the previous candle for the next computation.
    this.prevCandle = candle;
  }

  public getResult() {
    return this.result;
  }
}
