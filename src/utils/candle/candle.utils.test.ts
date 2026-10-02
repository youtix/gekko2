import { ONE_MINUTE } from '@constants/time.const';
import { TIMEFRAME_TO_MINUTES } from '@constants/timeframe.const';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { CandleSize } from '@services/core/batcher/candleBatcher/candleBatcher.types';
import { CandleBucketBatcher } from '@services/core/batcher/candleBatcher/candleBucketBatcher';
import { range, sortedUniq } from 'lodash-es';
import { describe, expect, it } from 'vitest';
import { toISOString, toTimestamp } from '../date/date.utils';
import { getCandleStart, getCandleTimeOffset, hl2, hlc3, ohlc4 } from './candle.utils';

describe('candle utils', () => {
  const defaultCandle: Candle = {
    close: 100,
    high: 150,
    low: 90,
    open: 110,
    start: toTimestamp('2025'),
    volume: 10,
  };

  describe('hl2', () => {
    it.each`
      high   | low    | expected
      ${5}   | ${3}   | ${4}
      ${10}  | ${2}   | ${6}
      ${1.5} | ${0.5} | ${1}
    `('returns $expected for high=$high and low=$low', ({ high, low, expected }) => {
      const candle = { ...defaultCandle, high, low };
      expect(hl2(candle)).toBe(expected);
    });
  });

  describe('hlc3', () => {
    it.each`
      high   | low    | close | expected
      ${5}   | ${3}   | ${4}  | ${4}
      ${6}   | ${2}   | ${4}  | ${4}
      ${1.5} | ${0.5} | ${2}  | ${1.3333333333333333}
    `('returns $expected for high=$high, low=$low and close=$close', ({ high, low, close, expected }) => {
      const candle = { ...defaultCandle, high, low, close };
      expect(hlc3(candle)).toBeCloseTo(expected);
    });
  });

  describe('ohlc4', () => {
    it.each`
      open   | high   | low    | close  | expected
      ${1}   | ${5}   | ${3}   | ${4}   | ${3.25}
      ${10}  | ${4}   | ${2}   | ${8}   | ${6}
      ${1.5} | ${3.5} | ${0.5} | ${2.5} | ${(1.5 + 3.5 + 0.5 + 2.5) / 4}
    `('returns $expected for open=$open, high=$high, low=$low and close=$close', ({ open, high, low, close, expected }) => {
      const candle = { ...defaultCandle, open, high, low, close };
      expect(ohlc4(candle)).toBeCloseTo(expected);
    });
  });

  describe('getCandleTimeOffset', () => {
    it.each`
      size     | expected
      ${1}     | ${0}
      ${5}     | ${53 % 5}
      ${120}   | ${(19 * 60 + 53) % 120}
      ${1440}  | ${19 * 60 + 53}
      ${10080} | ${((0 + 6) % 7) * 1440 + 19 * 60 + 53}
      ${43200} | ${Math.floor((toTimestamp('2025-06-22T19:53:30Z') - Date.UTC(2025, 5, 1)) / 60000)}
    `('should return $size => $expected', ({ size, expected }) => {
      expect(getCandleTimeOffset(size, toTimestamp('2025-06-22T19:53:30Z'))).toBe(expected);
    });
  });

  describe('getCandleStart', () => {
    it.each`
      size      | minute                    | count | expected
      ${1}      | ${'2024-02-29T23:59:00Z'} | ${0}  | ${'2024-02-29T23:59:00Z'}
      ${1}      | ${'2024-03-01T00:00:00Z'} | ${3}  | ${'2024-02-29T23:57:00Z'}
      ${5}      | ${'2024-03-01T10:23:00Z'} | ${2}  | ${'2024-03-01T10:10:00Z'}
      ${240}    | ${'2024-03-01T10:23:00Z'} | ${1}  | ${'2024-03-01T04:00:00Z'}
      ${1440}   | ${'2024-03-01T10:23:00Z'} | ${1}  | ${'2024-02-29T00:00:00Z'}
      ${10080}  | ${'2024-03-01T10:23:00Z'} | ${1}  | ${'2024-02-19T00:00:00Z'}
      ${43200}  | ${'2024-03-15T10:23:00Z'} | ${0}  | ${'2024-03-01T00:00:00Z'}
      ${43200}  | ${'2024-03-15T10:23:00Z'} | ${1}  | ${'2024-02-01T00:00:00Z'}
      ${43200}  | ${'2024-01-15T10:23:00Z'} | ${2}  | ${'2023-11-01T00:00:00Z'}
      ${129600} | ${'2024-05-15T10:23:00Z'} | ${1}  | ${'2024-01-01T00:00:00Z'}
      ${129600} | ${'2024-02-10T10:23:00Z'} | ${2}  | ${'2023-07-01T00:00:00Z'}
      ${259200} | ${'2024-08-15T10:23:00Z'} | ${1}  | ${'2024-01-01T00:00:00Z'}
      ${259200} | ${'2024-03-15T10:23:00Z'} | ${3}  | ${'2022-07-01T00:00:00Z'}
      ${518400} | ${'2024-12-31T23:59:00Z'} | ${0}  | ${'2024-01-01T00:00:00Z'}
      ${518400} | ${'2024-03-15T10:23:00Z'} | ${2}  | ${'2022-01-01T00:00:00Z'}
    `('should return $expected for $count candles of $size minutes before the one holding $minute', ({ size, minute, count, expected }) => {
      expect(getCandleStart(size, toTimestamp(minute), count)).toBe(toTimestamp(expected));
    });

    describe('replayed through the TradingAdvisor batcher', () => {
      const symbol = 'BTC/USDT';
      const bucketAt = (start: EpochTimeStamp): CandleBucket => new Map([[symbol, { ...defaultCandle, start }]]);
      // Every month of 2023-2028 (2024 and 2028 are leap years): its first, second, a middle and its last minute
      const minutes = range(2023, 2029).flatMap(year =>
        range(12).flatMap(month => [
          Date.UTC(year, month, 1, 0, 0),
          Date.UTC(year, month, 1, 0, 1),
          Date.UTC(year, month, 15, 12, 34),
          Date.UTC(year, month + 1, 0, 23, 59),
        ]),
      );
      // Candles close on the last minute of a month (1M and longer), of a day (1d, 1w) or of an intraday candle
      const monthEnds = range(12 * 12).map(month => Date.UTC(2018, month + 1, 1) - ONE_MINUTE);
      const closeCandidates = (size: CandleSize, start: EpochTimeStamp, end: EpochTimeStamp) => {
        if (size >= TIMEFRAME_TO_MINUTES['1M']) return monthEnds;
        const step = Math.min(size, TIMEFRAME_TO_MINUTES['1d']) * ONE_MINUTE;
        return range(Math.ceil((start + ONE_MINUTE) / step) * step - ONE_MINUTE, end + 1, step);
      };

      // Feeds the batcher the history from `start` to `end`: its first and last minutes and every candle close in between
      const replay = (size: CandleSize, start: EpochTimeStamp, end: EpochTimeStamp) => {
        const closes = closeCandidates(size, start, end).filter(minute => minute > start && minute < end);
        const history = start > end ? [] : sortedUniq([start, ...closes, end]);
        const batcher = new CandleBucketBatcher([symbol], size);
        return {
          // The history starts on a candle boundary when the minute before it closes a candle
          startsOnBoundary: new CandleBucketBatcher([symbol], size).addBucket(bucketAt(start - ONE_MINUTE)) !== undefined,
          closedCandles: history.filter(minute => batcher.addBucket(bucketAt(minute))).length,
        };
      };

      it.each`
        timeframe
        ${'1m'}
        ${'5m'}
        ${'1h'}
        ${'4h'}
        ${'1d'}
        ${'1w'}
        ${'1M'}
        ${'3M'}
        ${'6M'}
        ${'1y'}
      `(
        'should start on a $timeframe candle boundary from which exactly count candles close before the one in progress, at any date',
        ({ timeframe }) => {
          const size = TIMEFRAME_TO_MINUTES[timeframe as keyof typeof TIMEFRAME_TO_MINUTES];
          const failures = [0, 1, 2, 3].flatMap(count =>
            minutes
              .map(minute => ({
                minute: toISOString(minute),
                count,
                ...replay(size, getCandleStart(size, minute, count), minute - ONE_MINUTE),
              }))
              .filter(({ startsOnBoundary, closedCandles }) => !startsOnBoundary || closedCandles !== count),
          );
          expect(failures).toEqual([]);
        },
      );
    });
  });
});
