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
  volumeActive: 0,
  quoteVolume: 0,
  quoteVolumeActive: 0,
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
        { ...candles[0], start: new Date('2024-06-01T00:01:00Z').getTime(), volume: 1 },
        candles[1],
        { ...candles[1], start: new Date('2024-06-01T00:03:00Z').getTime(), volume: 1 },
        { ...candles[1], start: new Date('2024-06-01T00:04:00Z').getTime(), volume: 1 },
        { ...candles[1], start: new Date('2024-06-01T00:05:00Z').getTime(), volume: 1 },
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
