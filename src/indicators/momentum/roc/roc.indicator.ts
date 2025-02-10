import { Indicator } from "@indicators/indicator";
import { Candle } from "@models/types/candle.types";
import Big from "big.js";

export class ROC extends Indicator<"ROC"> {
  private period: number;
  private fifo: number[];
  private age: number;

  constructor({ period }: IndicatorRegistry["ROC"]["input"]) {
    super("ROC", null);
    this.period = period;
    this.fifo = [];
    this.age = 0;
  }

  public onNewCandle({ close }: Candle): void {
    // Warmup phase
    if (this.age < this.period) {
      this.fifo = [...this.fifo, close];
      this.age++;
      // Compute the first ROC value.
      if (this.age === this.period)
        this.result = this.computeROC(this.fifo[0], close);
      return;
    }

    const [oldest, ...rest] = this.fifo;
    this.fifo = [...rest, close];
    this.result = this.computeROC(oldest, close);
  }

  private computeROC(oldest: number, close: number) {
    // Compute ROC: ((currentClose / oldestClose) - 1) * 100
    return oldest === 0 ? 0 : +Big(close).div(oldest).minus(1).times(100);
  }

  public getResult() {
    return this.result;
  }
}
