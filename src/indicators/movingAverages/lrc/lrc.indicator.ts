import { Candle } from '@models/types/candle.types';
import { linreg } from '@utils/math/math';
import { drop } from 'lodash-es';
import { Indicator } from '../../indicator';

export class LRC extends Indicator<'LRC'> {
  private history: number[];
  private readonly depth: number;
  private readonly x: number[];

  constructor({ depth }: IndicatorRegistry['LRC']['input']) {
    super('LRC', NaN);
    this.depth = depth;
    // Start with an empty history array.
    this.history = [];
    // Precompute the x-axis indices: [0, 1, 2, ..., depth - 1].
    this.x = Array.from({ length: depth }, (_, i) => i);
  }

  public onNewCandle(candle: Candle): void {
    this.history = [...this.history, candle.close];
    if (this.history.length < this.depth) return;
    if (this.history.length > this.depth) this.history = drop(this.history);

    // Compute linear regression on the history.
    const [m, b] = linreg(this.x, this.history);

    // Predict the value at the last x-value.
    this.result = (this.depth - 1) * m + b;
  }

  public getResult(): number {
    return this.result;
  }
}
