import { Candle } from '@models/candle.types';
import { describe, expect, it } from 'vitest';
import { mapKlinesToCandles, mapToTrades } from './trade.utils';

describe('trade.utils', () => {
  const kline1 = [123456, 1, 2, 0.5, 1.5, 100, 0, 10, 0, 256, 234];
  const kline2 = [123457, 1.5, 2.5, 1, 2, 200, 0, 5, 0, 156, 123];
  const candle1: Candle = {
    start: 123456,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 100,
    quoteVolume: 10,
    quoteVolumeActive: 234,
    volumeActive: 256,
  };
  const candle2: Candle = {
    start: 123457,
    open: 1.5,
    high: 2.5,
    low: 1,
    close: 2,
    volume: 200,
    quoteVolume: 5,
    quoteVolumeActive: 123,
    volumeActive: 156,
  };

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
      candles             | expected
      ${[kline1, kline2]} | ${[candle1, candle2]}
      ${[]}               | ${[]}
    `('should map candles=$candles to $expected', ({ candles, expected }) => {
      const result = mapKlinesToCandles(candles);
      expect(result).toEqual(expected);
    });
  });
});
