import { Candle } from '@models/types/candle.types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../date/date.utils';
import { fillMissingCandles, getCandleTimeOffset, hl2, hlc3, ohlc4 } from './candle.utils';

const createCandle = (start: number, open: number, close: number, high: number, low: number, volume: number) => ({
  start,
  open,
  close,
  high,
  low,
  volume,
});
const candles = [
  createCandle(toTimestamp('2024-06-01T00:00:00Z'), 100, 100, 100, 100, 1),
  createCandle(toTimestamp('2024-06-01T00:02:00Z'), 102, 102, 102, 102, 1),
  createCandle(toTimestamp('2024-06-01T00:06:00Z'), 104, 104, 104, 104, 1),
];

describe('candle utils', () => {
  const defaultCandle: Candle = { close: 100, high: 150, low: 90, open: 110, start: toTimestamp('2025'), volume: 10 };
  describe('fillMissingCandles', () => {
    it('should fill gaps between candles with empty candles', () => {
      const result = fillMissingCandles(candles);

      expect(result).toEqual([
        candles[0],
        { ...candles[0], start: new Date('2024-06-01T00:01:00Z').getTime(), volume: 0 },
        candles[1],
        { ...candles[1], start: new Date('2024-06-01T00:03:00Z').getTime(), volume: 0 },
        { ...candles[1], start: new Date('2024-06-01T00:04:00Z').getTime(), volume: 0 },
        { ...candles[1], start: new Date('2024-06-01T00:05:00Z').getTime(), volume: 0 },
        candles[2],
      ]);
    });

    it('should return empty array when no candles are provided', () => {
      const result = fillMissingCandles([]);
      expect(result).toBeUndefined();
    });
  });

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
    `(
      'returns $expected for open=$open, high=$high, low=$low and close=$close',
      ({ open, high, low, close, expected }) => {
        const candle = { ...defaultCandle, open, high, low, close };
        expect(ohlc4(candle)).toBeCloseTo(expected);
      },
    );
  });

  describe('getCandleTimeOffset', () => {
    beforeAll(() => {
      vi.useFakeTimers().setSystemTime(toTimestamp('2025-06-22T19:53:30Z'));
    });

    it.each`
      size     | expected
      ${1}     | ${0}
      ${5}     | ${53 % 5}
      ${120}   | ${(19 * 60 + 53) % 120}
      ${1440}  | ${19 * 60 + 53}
      ${10080} | ${((0 + 6) % 7) * 1440 + 19 * 60 + 53}
      ${43200} | ${Math.floor((toTimestamp('2025-06-22T19:53:30Z') - Date.UTC(2025, 5, 1)) / 60000)}
    `('should return $size => $expected', ({ size, expected }) => {
      expect(getCandleTimeOffset(size)).toBe(expected);
    });

    afterAll(() => {
      vi.useRealTimers();
    });
  });
});

// describe('bridgeCandleGap', () => {
//   it('returns an empty array when fetched candles array is empty', () => {
//     const before = createCandle(1000, 50, 100, 110, 40, 10);
//     const after = createCandle(5000, 120, 130, 135, 115, 20);
//     const resultEmpty = bridgeCandleGap([], before, after);
//     expect(resultEmpty).toEqual([]);
//   });

//   it('returns an empty array when no valid fetched candles exist', () => {
//     const before = createCandle(1000, 50, 100, 110, 40, 10);
//     const after = createCandle(5000, 120, 130, 135, 115, 20);
//     const fetched = [createCandle(6000, 150, 200, 220, 190, 10), createCandle(7000, 210, 250, 260, 205, 20)];
//     const resultInvalid = bridgeCandleGap(fetched, before, after);
//     expect(resultInvalid).toEqual([]);
//   });

//   it('returns an array with only a start candle when one valid fetched candle exists', () => {
//     const before = createCandle(1000, 50, 100, 110, 40, 10);
//     const after = createCandle(5000, 120, 130, 135, 115, 20);
//     const fetched = [createCandle(2000, 150, 200, 220, 190, 10)];
//     const result = bridgeCandleGap(fetched, before, after);

//     const expectedStart = createCandle(2000, before.close, 200, 220, 100, 10);
//     expect(result).toEqual([expectedStart]);
//   });

//   it('returns an array with start and end candles when two valid fetched candles exist', () => {
//     const before = createCandle(1000, 50, 100, 110, 40, 10);
//     const after = createCandle(5000, 110, 130, 135, 115, 20);
//     const firstFetched = createCandle(2000, 150, 200, 220, 190, 10);
//     const secondFetched = createCandle(3000, 210, 250, 260, 205, 20);
//     const result = bridgeCandleGap([firstFetched, secondFetched], before, after);

//     const expectedStart = createCandle(2000, before.close, 200, 220, 100, 10);
//     const expectedEnd = createCandle(3000, 210, after.open, 260, 110, 20);

//     expect(result).toEqual([expectedStart, expectedEnd]);
//   });

//   it('returns an array with start, intermediate, and end candles when three valid fetched candles exist', () => {
//     const before = createCandle(1000, 50, 100, 110, 40, 10);
//     const after = createCandle(5000, 120, 130, 135, 115, 20);
//     const firstFetched = createCandle(2000, 150, 200, 220, 190, 10);
//     const secondFetched = createCandle(2500, 205, 210, 215, 200, 15);
//     const thirdFetched = createCandle(3000, 212, 230, 235, 210, 20);
//     const result = bridgeCandleGap([firstFetched, secondFetched, thirdFetched], before, after);

//     const expectedStart = createCandle(2000, before.close, 200, 220, 100, 10);
//     const expectedEnd = createCandle(3000, thirdFetched.open, after.open, 235, 120, 20);

//     expect(result).toEqual([expectedStart, secondFetched, expectedEnd]);
//   });
// });
