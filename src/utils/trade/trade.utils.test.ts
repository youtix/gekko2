import { describe, expect, it } from 'vitest';
import { mapToCandles, mapToTrades } from './trade.utils';

describe('trade.utils', () => {
  describe('mapToTrades', () => {
    it.each`
      trades                                                                                                           | expected
      ${[{ amount: 1, price: 100, timestamp: 123456, extra: 'ignore' }, { amount: 2, price: 200, timestamp: 123457 }]} | ${[{ amount: 1, price: 100, timestamp: 123456 }, { amount: 2, price: 200, timestamp: 123457 }]}
      ${[]}                                                                                                            | ${[]}
    `('should map trades=$trades to $expected', ({ trades, expected }) => {
      const result = mapToTrades(trades);
      expect(result).toEqual(expected);
    });
  });

  describe('mapToCandles', () => {
    it.each`
      candles                                                           | expected
      ${[[123456, 1, 2, 0.5, 1.5, 100], [123457, 1.5, 2.5, 1, 2, 200]]} | ${[{ start: 123456, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }, { start: 123457, open: 1.5, high: 2.5, low: 1, close: 2, volume: 200 }]}
      ${[]}                                                             | ${[]}
      ${[[123456, 1, 2, 0.5]]}                                          | ${[{ start: 123456, open: 1, high: 2, low: 0.5, close: undefined, volume: undefined }]}
    `('should map candles=$candles to $expected', ({ candles, expected }) => {
      const result = mapToCandles(candles);
      expect(result).toEqual(expected);
    });
  });
});
