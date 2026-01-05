import { Candle } from '@models/candle.types';
import { describe, expect, it } from 'vitest';
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
const candles: [Candle, Candle] = [
  createCandle(toTimestamp('2024-06-01T00:00:00Z'), 100, 100, 100, 100, 1),
  createCandle(toTimestamp('2024-06-01T00:02:00Z'), 102, 102, 102, 102, 1),
];

describe('candle utils', () => {
  const defaultCandle: Candle = { close: 100, high: 150, low: 90, open: 110, start: toTimestamp('2025'), volume: 10 };
  describe('fillMissingCandles', () => {
    it('should fill gaps between candles with empty candles', () => {
      const result = fillMissingCandles(candles);

      expect(result).toEqual([
        candles[0],
        {
          ...candles[0],
          start: new Date('2024-06-01T00:01:00Z').getTime(),
          volume: 1,
          close: 102,
          high: 102,
          low: 100,
        },
        candles[1],
      ]);
    });

    it('should fill gaps in a list of multiple candles', () => {
      const inputCandles: [Candle, Candle, ...Candle[]] = [
        candles[0],
        {
          ...candles[0],
          start: new Date('2024-06-01T00:02:00Z').getTime(),
          open: 105,
          close: 110,
          high: 110,
          low: 105,
        },
        {
          ...candles[0],
          start: new Date('2024-06-01T00:05:00Z').getTime(),
          open: 115,
          close: 120,
          high: 120,
          low: 115,
        },
      ];

      const result = fillMissingCandles(inputCandles);

      expect(result).toHaveLength(6); // 00, 01(gap), 02, 03(gap), 04(gap), 05
      expect(result?.[1]).toEqual({
        ...candles[0],
        start: new Date('2024-06-01T00:01:00Z').getTime(),
        volume: 1,
        close: 105, // Links to next open
        high: 105,
        low: 100,
      });
      expect(result?.[3]).toEqual({
        ...candles[0],
        start: new Date('2024-06-01T00:03:00Z').getTime(),
        volume: 1,
        close: 110, // Links to next open (at 05) - WAIT. Next real is at 05. 04 is empty. So 03 -> 04 is empty. So close = prevClose (110).
        high: 110,
        low: 110, // Previous close was 110
        open: 110,
      });
      expect(result?.[4]).toEqual({
        ...candles[0],
        start: new Date('2024-06-01T00:04:00Z').getTime(),
        volume: 1,
        close: 115, // Links to next open (at 05). Next real is at 05. So close = 115.
        high: 115,
        low: 110, // Previous close was 110 (from synthetic candle at 03)
        open: 110,
      });
    });

    it('should handle large gaps correctly', () => {
      const inputCandles: [Candle, Candle] = [
        createCandle(toTimestamp('2024-06-01T00:00:00Z'), 100, 100, 100, 100, 1),
        createCandle(toTimestamp('2024-06-01T00:10:00Z'), 200, 200, 200, 200, 1),
      ];

      const result = fillMissingCandles(inputCandles);

      expect(result).toHaveLength(11);
      // Check a middle candle
      const middleCandle = result?.[5];
      expect(middleCandle).toEqual({
        ...inputCandles[0],
        start: toTimestamp('2024-06-01T00:05:00Z'),
        open: 100,
        close: 100, // Still flat in the middle of the gap
        high: 100,
        low: 100,
        volume: 1,
      });

      // The last synthetic candle should link to the next real candle
      const lastSynthetic = result?.[9];
      expect(lastSynthetic).toEqual({
        ...inputCandles[0],
        start: toTimestamp('2024-06-01T00:09:00Z'),
        open: 100,
        close: 200, // Links to next open (200)
        high: 200,
        low: 100,
        volume: 1,
      });
    });

    it('should handle already contiguous candles', () => {
      const contiguousCandles: [Candle, Candle] = [
        createCandle(toTimestamp('2024-06-01T00:00:00Z'), 100, 100, 100, 100, 1),
        createCandle(toTimestamp('2024-06-01T00:01:00Z'), 100, 100, 100, 100, 1),
      ];
      const result = fillMissingCandles(contiguousCandles);
      expect(result).toEqual(contiguousCandles);
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
});
