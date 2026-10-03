import { ONE_MINUTE } from '@constants/time.const';
import { GekkoError } from '@errors/gekko.error';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { CandleSize } from '@services/core/batcher/candleBatcher/candleBatcher.types';

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

/** Minutes from the start of the timeframe candle of `candleSize` minutes holding `start` (0 on a timeframe boundary). */
export const getCandleTimeOffset = (candleSize: CandleSize, start: EpochTimeStamp): number => {
  const date = new Date(start);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const minutesSinceMidnight = date.getUTCHours() * 60 + date.getUTCMinutes();
  const minutesSince = (periodStart: EpochTimeStamp) => Math.floor((start - periodStart) / ONE_MINUTE);

  switch (candleSize) {
    case 1:
    case 2:
    case 3:
    case 5:
    case 10:
    case 15:
    case 30:
      return date.getUTCMinutes() % candleSize;
    case 60:
    case 120:
    case 240:
    case 360:
    case 480:
    case 720:
      return minutesSinceMidnight % candleSize;
    case 1440:
      return minutesSinceMidnight;
    case 10080:
      return ((date.getUTCDay() + 6) % 7) * 1440 + minutesSinceMidnight; // Weeks start on Monday
    case 43200:
      return minutesSince(Date.UTC(year, month, 1));
    case 129600:
      return minutesSince(Date.UTC(year, month - (month % 3), 1));
    case 259200:
      return minutesSince(Date.UTC(year, month - (month % 6), 1));
    case 518400:
      return minutesSince(Date.UTC(year, 0, 1));
    default: {
      // A size added to TIMEFRAME_TO_MINUTES without a case here fails to compile
      const unsupported: never = candleSize;
      throw new GekkoError('utils', `Unsupported candle size: ${unsupported} minutes`);
    }
  }
};

// 1M, 3M, 6M and 1y candles span whole UTC months, so their length in minutes varies
const MONTHS_PER_CANDLE: Partial<Record<number, number>> = { 43200: 1, 129600: 3, 259200: 6, 518400: 12 };

/** Start of the candle `count` candles before the one holding `minute` (a minute start), on the candle batcher's boundaries. */
export const getCandleStart = (candleSize: CandleSize, minute: EpochTimeStamp, count: number) => {
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
