import Big from 'big.js';
import { first, last, max, min, take } from 'lodash-es';
import { beforeEach, describe, expect, it } from 'vitest';
import { candles } from '../../../../models/candle.mock';
import { CandleBatcher } from './candleBatcher';

describe('candleBatcher', () => {
  let candleBatcher: CandleBatcher;

  beforeEach(() => {
    candleBatcher = new CandleBatcher(2);
  });

  it('should not create a candle when fed not enough small candles', () => {
    const candle = first(candles);
    const result = candleBatcher.addSmallCandle(candle!);
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
