import Big from 'big.js';
import { first, last, max, min, take } from 'lodash-es';
import { beforeEach, describe, expect, it } from 'vitest';
import { toTimestamp } from '../../../../utils/date/date.utils';
import { CandleBatcher } from './candleBatcher';

const candles = [
  {
    id: 1,
    start: toTimestamp('2015-02-14T23:57:00.000Z'),
    open: 257.19,
    high: 257.19,
    low: 257.18,
    close: 257.18,
    volume: 0.97206065,
  },
  {
    id: 2,
    start: toTimestamp('2015-02-14T23:58:00.000Z'),
    open: 257.02,
    high: 257.02,
    low: 256.98,
    close: 256.98,
    volume: 4.1407478,
  },
  {
    id: 3,
    start: toTimestamp('2015-02-14T23:59:00.000Z'),
    open: 256.85,
    high: 256.99,
    low: 256.85,
    close: 256.99,
    volume: 6,
  },
  {
    id: 4,
    start: toTimestamp('2015-02-15T00:00:00.000Z'),
    open: 256.81,
    high: 256.82,
    low: 256.81,
    close: 256.82,
    volume: 4,
  },
  {
    id: 5,
    start: toTimestamp('2015-02-15T00:01:00.000Z'),
    open: 256.81,
    high: 257.02,
    low: 256.81,
    close: 257.01,
    volume: 6,
  },
  {
    id: 6,
    start: toTimestamp('2015-02-15T00:02:00.000Z'),
    open: 257.03,
    high: 257.03,
    low: 256.33,
    close: 256.33,
    volume: 6.7551178,
  },
  {
    id: 7,
    start: toTimestamp('2015-02-15T00:03:00.000Z'),
    open: 257.02,
    high: 257.47,
    low: 257.02,
    close: 257.47,
    volume: 3.7384995300000003,
  },
  {
    id: 8,
    start: toTimestamp('2015-02-15T00:04:00.000Z'),
    open: 257.47,
    high: 257.48,
    low: 257.37,
    close: 257.38,
    volume: 8,
  },
  {
    id: 9,
    start: toTimestamp('2015-02-15T00:05:00.000Z'),
    open: 257.38,
    high: 257.45,
    low: 257.38,
    close: 257.45,
    volume: 7.97062564,
  },
  {
    id: 10,
    start: toTimestamp('2015-02-15T00:06:00.000Z'),
    open: 257.46,
    high: 257.48,
    low: 257.46,
    close: 257.48,
    volume: 7.5,
  },
];
describe('candleBatcher', () => {
  let candleBatcher: CandleBatcher;

  beforeEach(() => {
    candleBatcher = new CandleBatcher(2);
  });

  it('should not create a candle when fed not enough small candles', () => {
    const result = candleBatcher.addSmallCandle(candles[0]);
    expect(result).toBeUndefined();
  });

  it('should return 5 results when fed 10 candles', () => {
    const result = candleBatcher.addSmallCandles(candles);
    expect(result).toHaveLength(5);
  });

  it('should correctly add two candles together', () => {
    const _candles = take(candles, 2);
    const firstCandle = first(_candles);
    const second = last(_candles);

    const expectedResult = {
      start: firstCandle?.start,
      open: firstCandle?.open,
      high: max([firstCandle?.high, second?.high]),
      low: min([firstCandle?.low, second?.low]),
      close: second?.close,
      volume: +Big(firstCandle?.volume ?? 0).plus(second?.volume ?? 0),
    };

    const result = candleBatcher.addSmallCandles(_candles);

    expect(result).toStrictEqual([expectedResult]);
    expect(first(result)?.id).toBeUndefined();
  });
});
