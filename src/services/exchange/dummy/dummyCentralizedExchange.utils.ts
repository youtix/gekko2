import { Candle } from '@models/candle.types';

/**
 * Finds the index of the first candle with a start timestamp greater than or equal to the given timestamp.
 * Uses binary search for O(log n) efficiency.
 *
 * @param candles Sorted array of candles
 * @param timestamp Timestamp to search for
 * @returns Index of the first candle >= timestamp, or candles.length if not found
 */
export const findCandleIndexByTimestamp = (candles: Candle[], timestamp: number): number => {
  let low = 0;
  let high = candles.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (candles[mid].start < timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
};
