import { Indicator } from '@indicators/indicator';
import { Candle } from '@models/types/candle.types';
import Big from 'big.js';

export class WilliamsR extends Indicator<'WilliamsR'> {
  private period: number;
  private fifoHigh: number[];
  private fifoLow: number[];
  private fifoClose: number[];
  private age: number;

  constructor({ period }: IndicatorRegistry['WilliamsR']['input'] = { period: 14 }) {
    super('WilliamsR', null);
    this.period = period;
    this.fifoHigh = [];
    this.fifoLow = [];
    this.fifoClose = [];
    this.age = 0;
  }

  public onNewCandle({ high, low, close }: Candle): void {
    // Warmup phase
    if (this.age < this.period) {
      this.fifoHigh.push(high);
      this.fifoLow.push(low);
      this.fifoClose.push(close);
      this.age++;
      if (this.age === this.period) this.result = this.computeWillR();
      return;
    }

    // Rolling window update
    this.fifoHigh = [...this.fifoHigh.slice(1), high];
    this.fifoLow = [...this.fifoLow.slice(1), low];
    this.fifoClose = [...this.fifoClose.slice(1), close];
    this.result = this.computeWillR();
  }

  private computeWillR() {
    const highest = Math.max(...this.fifoHigh);
    const lowest = Math.min(...this.fifoLow);
    const lastClose = this.fifoClose[this.fifoClose.length - 1];
    if (highest === lowest) return 0;
    // Williams %R = (Close - HighestHigh) / (HighestHigh - LowestLow) * 100
    return +Big(lastClose).minus(highest).div(Big(highest).minus(lowest)).times(100);
  }

  public getResult() {
    return this.result;
  }
}
