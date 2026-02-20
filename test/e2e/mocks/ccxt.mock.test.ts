import { beforeEach, describe, expect, it } from 'bun:test';
import { MockCCXTExchange } from './ccxt.mock';

describe('MockCCXTExchange', () => {
  let exchange: MockCCXTExchange;

  beforeEach(() => {
    exchange = new MockCCXTExchange({});
    MockCCXTExchange.resetPredefinedCandles();
  });

  describe('Predefined Candles', () => {
    it('should return predefined candles one by one and fallback to synthetic data', async () => {
      const symbol = 'BTC/USDT';

      MockCCXTExchange.setPredefinedCandles(symbol, [
        { close: 100 },
        { close: 105, volume: 10 },
        { close: 102, high: 110, low: 100, open: 103 },
      ]);

      // 1st tick
      let result = await exchange.fetchOHLCV(symbol, '1m', 1000, 100);
      expect(result).toHaveLength(1);
      // timestamp, open, high, low, close, volume
      expect(result[0]).toEqual([1000, 100, 100, 100, 100, 50]);

      // 2nd tick
      result = await exchange.fetchOHLCV(symbol, '1m', 2000, 100);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual([2000, 105, 105, 105, 105, 10]);

      // 3rd tick
      result = await exchange.fetchOHLCV(symbol, '1m', 3000, 100);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual([3000, 103, 110, 100, 102, 50]);

      // 4th tick - should fallback to synthetic
      result = await exchange.fetchOHLCV(symbol, '1m', 4000, 2);
      expect(result).toHaveLength(2);
      expect(result[0][0]).toBe(4000); // starts at since
      // Since it's synthetic data, it shouldn't match our predefined close
      expect(result[0][4]).not.toBe(102);
    });

    it('should respect resetPredefinedCandles', async () => {
      const symbol = 'BTC/USDT';
      MockCCXTExchange.setPredefinedCandles(symbol, [{ close: 100 }]);
      MockCCXTExchange.resetPredefinedCandles();

      const result = await exchange.fetchOHLCV(symbol, '1m', 1000, 2);
      // Because we reset, we should get standard synthetic data
      expect(result).toHaveLength(2);
    });
  });
});
