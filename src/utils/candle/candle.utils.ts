import { Candle } from '@models/candle.types';
import { Undefined } from '@models/utility.types';
import { addMinutes, differenceInMinutes, isBefore } from 'date-fns';
import { filter, first, last, map } from 'lodash-es';

export const hl2 = (candle: Candle): number => (candle.high + candle.low) / 2;
export const hlc3 = (candle: Candle): number => (candle.high + candle.low + candle.close) / 3;
export const ohlc4 = (candle: Candle): number => (candle.open + candle.high + candle.low + candle.close) / 4;

export const fillMissingCandles = (candles: Candle[]): Undefined<Candle[]> => {
  const firstCandleStart = first(candles)?.start;
  const lastCandleStart = last(candles)?.start;

  if (!candles.length || !firstCandleStart || !lastCandleStart) return;
  const startDates = map(candles, c => c.start);

  return Array(differenceInMinutes(lastCandleStart, firstCandleStart) + 1)
    .fill(undefined)
    .map((_, index) => {
      const startDate = addMinutes(firstCandleStart, index).getTime();
      if (startDates.includes(startDate)) return candles[startDates.indexOf(startDate)];
      const lastCandle = last(filter(candles, c => isBefore(c.start, startDate)));
      const lastCandlePrice = lastCandle?.close ?? 0;
      return {
        start: startDate,
        open: lastCandlePrice,
        high: lastCandlePrice,
        low: lastCandlePrice,
        close: lastCandlePrice,
        volume: lastCandle?.volume ?? 0,
        volumeActive: lastCandle?.volumeActive ?? 0,
        quoteVolume: lastCandle?.quoteVolume ?? 0,
        quoteVolumeActive: lastCandle?.quoteVolumeActive ?? 0,
      };
    });
};

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

// export const bridgeCandleGap = (fetchedCandles: Candle[], before: Candle, after: Candle) => {
//   const validCandles = fetchedCandles.filter(c => c.start < after.start);
//   if (!validCandles.length) return [];

//   const [firstFetched, ...intermediateCandles] = validCandles;
//   const startCandle: Candle = {
//     start: firstFetched.start,
//     open: before.close,
//     close: firstFetched.close,
//     high: before.close > firstFetched.high ? before.close : firstFetched.high,
//     low: before.close < firstFetched.low ? before.close : firstFetched.low,
//     volume: firstFetched.volume,
//   };
//   const lastFetched = last(intermediateCandles);
//   if (!lastFetched) return [startCandle];

//   const endCandle: Candle = {
//     start: lastFetched.start,
//     open: lastFetched.open,
//     close: after.open,
//     high: after.open > lastFetched.high ? after.open : lastFetched.high,
//     low: after.open < lastFetched.low ? after.open : lastFetched.low,
//     volume: lastFetched.volume,
//   };

//   return [startCandle, ...dropRight(intermediateCandles), endCandle];
// };
