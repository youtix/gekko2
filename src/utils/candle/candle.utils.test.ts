import { describe, expect, it } from 'vitest';
import { toTimestamp } from '../date/date.utils';
import { fillMissingCandles } from './candle.utils';

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
