import { ONE_MINUTE } from '@constants/time.const';
import { Candle } from '@models/candle.types';

export const hl2 = (candle: Candle): number => (candle.high + candle.low) / 2;
export const hlc3 = (candle: Candle): number => (candle.high + candle.low + candle.close) / 3;
export const ohlc4 = (candle: Candle): number => (candle.open + candle.high + candle.low + candle.close) / 4;

export const createEmptyCandle = (lastCandle: Candle) => ({
  ...lastCandle,
  start: lastCandle.start + ONE_MINUTE,
  open: lastCandle.close,
  close: lastCandle.close,
  high: lastCandle.close,
  low: lastCandle.close,
  volume: 0,
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
