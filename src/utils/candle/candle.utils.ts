import { ONE_MINUTE } from '@constants/time.const';
import { GekkoError } from '@errors/gekko.error';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';

export const hl2 = (candle: Candle): number => (candle.high + candle.low) / 2;
export const hlc3 = (candle: Candle): number => (candle.high + candle.low + candle.close) / 3;
export const ohlc4 = (candle: Candle): number => (candle.open + candle.high + candle.low + candle.close) / 4;

/** The minute after `lastCandle`, made up for want of a real one: flat at its close, volume 0, marked synthetic and without `id`. */
export const createEmptyCandle = (lastCandle: Candle): Candle => ({
  start: lastCandle.start + ONE_MINUTE,
  open: lastCandle.close,
  high: lastCandle.close,
  low: lastCandle.close,
  close: lastCandle.close,
  volume: 0,
  synthetic: true,
});

export const getCandleTimeOffset = (candleSize: number, start: EpochTimeStamp) => {
  const now = new Date(start);

  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const month = now.getUTCMonth();
  const weekday = now.getUTCDay();

  if (candleSize <= 1) return 0;
  if (candleSize < 60) return minute % candleSize;

  const minutesSinceMidnight = hour * 60 + minute;

  if (candleSize < 1440) return minutesSinceMidnight % candleSize;
  if (candleSize < 10080) return minutesSinceMidnight;
  if (candleSize === 10080) return ((weekday + 6) % 7) * 1440 + minutesSinceMidnight;

  const startOfMonth = Date.UTC(now.getUTCFullYear(), month, 1);
  if (candleSize === 43200) return Math.floor((now.getTime() - startOfMonth) / 60000);

  if (candleSize === 129600) {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    const quarterStart = Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1);
    return Math.floor((now.getTime() - quarterStart) / 60000);
  }

  if (candleSize === 259200) {
    const halfStartMonth = Math.floor(month / 6) * 6;
    const halfStart = Date.UTC(now.getUTCFullYear(), halfStartMonth, 1);
    return Math.floor((now.getTime() - halfStart) / 60000);
  }

  if (candleSize === 518400) {
    const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
    return Math.floor((now.getTime() - startOfYear) / 60000);
  }

  return 0;
};

// 1M, 3M, 6M and 1y candles span whole UTC months, so their length in minutes varies
const MONTHS_PER_CANDLE: Partial<Record<number, number>> = { 43200: 1, 129600: 3, 259200: 6, 518400: 12 };

/** Start of the candle `count` candles before the one holding `minute` (a minute start), on the candle batcher's boundaries. */
export const getCandleStart = (candleSize: number, minute: EpochTimeStamp, count: number) => {
  const candleStart = minute - getCandleTimeOffset(candleSize, minute) * ONE_MINUTE;
  const months = MONTHS_PER_CANDLE[candleSize];
  if (!months) return candleStart - count * candleSize * ONE_MINUTE;

  const date = new Date(candleStart);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - count * months, 1);
};

const peekCandle = (bucket: CandleBucket): Candle | undefined => bucket.values().next().value;

/** The minute of a bucket (all its candles share it), or undefined for an empty bucket */
export const getBucketTimestamp = (bucket: CandleBucket): EpochTimeStamp | undefined => peekCandle(bucket)?.start;

export const getFirstCandleFromBucket = (bucket: CandleBucket) => {
  const firstCandle = peekCandle(bucket);
  if (!firstCandle) throw new GekkoError('utils', 'Impossible to get first candle from bucket: Empty candle bucket');
  return firstCandle;
};
