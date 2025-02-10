import { Candle } from "@models/types/candle.types";
import { sum, sumBy } from "@utils/math/math.utils";
import Big from "big.js";
import { Indicator } from "../../indicator";

export class CCI extends Indicator<"CCI"> {
  // Constant multiplier (usually 0.015 for CCI)
  protected readonly constant: number;
  // Maximum number of candles to consider (history size)
  protected readonly historySize: number;
  // Circular buffer to store typical prices
  protected history: number[];
  // Latest typical price
  protected tp: number;
  // Number of valid values stored (grows until it reaches historySize)
  protected size: number;
  // Pointer for the next insertion position in the circular buffer
  protected currentIndex: number;

  constructor({ constant, history }: IndicatorRegistry["CCI"]["input"]) {
    super("CCI", NaN);
    this.constant = constant;
    this.historySize = history;
    // Pre-fill the history with zeros
    this.history = new Array<number>(history).fill(0);
    this.tp = 0;
    this.size = 0;
    this.currentIndex = 0;
  }

  /**
   * Process a new candle and update the CCI result.
   * @param candle The latest candle data.
   */
  public onNewCandle(candle: Candle): void {
    // Calculate the typical price (TP) for the candle
    this.tp = +Big(candle.high).plus(candle.close).plus(candle.low).div(3);

    // Insert the new tp into the circular buffer
    this.history[this.currentIndex] = this.tp;
    this.currentIndex = (this.currentIndex + 1) % this.historySize;
    if (this.size < this.historySize) this.size++;

    // Not enough data yet
    if (this.size < this.historySize) return;

    // Calculate the average typical price (avgtp)
    const avgtp = sum(this.history) / this.size;

    // Calculate the mean absolute deviation from the average typical price
    const sumAbsDeviation = sumBy(
      this.history,
      (value) => +Big(value).minus(avgtp).abs(),
    );
    const mean = +Big(sumAbsDeviation).div(this.size);

    // Protect against division by zero
    if (mean === 0) this.result = 0;
    else
      this.result = +Big(this.tp)
        .minus(avgtp)
        .div(+Big(this.constant).mul(mean));
  }

  /**
   * Retrieve the latest CCI result.
   * @returns The latest CCI value or NaN if insufficient data.
   */
  public getResult(): number {
    return this.result;
  }
}
