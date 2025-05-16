import { Candle } from '@models/types/candle.types';
import { Undefined } from '@models/types/generic.types';
import Big from 'big.js';
import { addMinutes, differenceInMinutes, isBefore } from 'date-fns';
import { filter, first, last, map } from 'lodash-es';

export const hl2 = (candle: Candle): number => +Big(candle.high).plus(candle.low).div(2);
export const hlc3 = (candle: Candle): number => +Big(candle.high).plus(candle.low).plus(candle.close).div(3);
export const ohlc4 = (candle: Candle): number =>
  +Big(candle.open).plus(candle.high).plus(candle.low).plus(candle.close).div(4);

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
        volume: 0,
      };
    });
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
