import { Candle } from '@models/candle.types';
import { warning } from '@services/logger';
import { getCandleTimeOffset } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { addPrecise } from '@utils/math/math.utils';
import { CandleSize } from './candleBatcher.types';

/** Tells whether the 1-minute candle starting at `start` is the last one of a timeframe candle of `candleSize` minutes. */
export const isTimeframeCandleClose = (candleSize: CandleSize, start: EpochTimeStamp): boolean => {
  const date = new Date(start);
  const size = candleSize;
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const day = date.getUTCDate();
  const month = date.getUTCMonth();
  const weekday = date.getUTCDay();

  if (size < 60) return minute % size === size - 1;
  if (size < 1440) {
    const hours = size / 60;
    return minute === 59 && hour % hours === hours - 1;
  }
  if (size < 10080) return hour === 23 && minute === 59;
  if (size === 10080) return weekday === 0 && hour === 23 && minute === 59;
  if (size === 43200) return isMonthEnd(date);
  if (size === 129600) return (month + 1) % 3 === 0 && isMonthEnd(date);
  if (size === 259200) return [5, 11].includes(month) && isMonthEnd(date);
  if (size === 518400) return month === 11 && day === 31 && hour === 23 && minute === 59;
  return false;
};

const isMonthEnd = (date: Date): boolean => {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return date.getUTCDate() === lastDay && date.getUTCHours() === 23 && date.getUTCMinutes() === 59;
};

/**
 * Optimized candle batcher that mutates in-place to minimize allocations.
 * For internal use by CandleBucketBatcher only.
 */
export class FastCandleBatcher {
  private accumulator: Candle | null = null;
  private readonly candleSize: CandleSize;
  /** Whether a candle starting on a timeframe boundary has been added yet: the ones before it are skipped */
  private hasStarted = false;
  private skippedMinutes = 0;
  private firstSkippedStart?: EpochTimeStamp;

  constructor(candleSize: CandleSize) {
    this.candleSize = candleSize;
  }

  /**
   * Add a 1-minute candle. Returns the completed timeframe candle if ready.
   * IMPORTANT: The returned candle is owned by this batcher; clone if you need to keep it.
   */
  addCandle(candle: Candle): Candle | null {
    if (!this.hasStarted && !this.startsOnBoundary(candle)) return null;

    if (this.accumulator === null) {
      // First candle: shallow clone without `id`
      this.accumulator = {
        start: candle.start,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
    } else {
      // Aggregate in-place
      this.accumulator.high = Math.max(this.accumulator.high, candle.high);
      this.accumulator.low = Math.min(this.accumulator.low, candle.low);
      this.accumulator.close = candle.close;
      this.accumulator.volume = addPrecise(this.accumulator.volume, candle.volume);
    }

    if (isTimeframeCandleClose(this.candleSize, candle.start)) {
      const result = this.accumulator;
      this.accumulator = null;
      return result;
    }

    return null;
  }

  /**
   * Until a candle starts on a timeframe boundary, counts the candles before it, which would only make up a shorter and
   * misdated first timeframe candle, then warns once about them.
   */
  private startsOnBoundary(candle: Candle) {
    if (getCandleTimeOffset(this.candleSize, candle.start) !== 0) {
      this.firstSkippedStart ??= candle.start;
      this.skippedMinutes++;
      return false;
    }

    this.hasStarted = true;
    if (this.skippedMinutes > 0) {
      warning(
        'core',
        [
          `Skipped ${this.skippedMinutes} one-minute candle(s) from ${toISOString(this.firstSkippedStart)}:`,
          `the first ${this.candleSize}-minute candle starts on the first boundary, ${toISOString(candle.start)}`,
        ].join(' '),
      );
    }
    return true;
  }
}
