import { describe, expect, it } from 'vitest';
import { mapToOrder, mapToTrades } from './trade.utils';

describe('trade.utils', () => {
  describe('mapToTrades', () => {
    it('should map trade payloads by picking relevant fields', () => {
      const trades = [
        { amount: 1, price: 100, timestamp: 123456, id: '1', fee: { rate: 0.1 }, extra: 'ignore' },
        { amount: 2, price: 200, timestamp: 123457, id: '2' },
      ];

      expect(mapToTrades(trades)).toEqual([
        { amount: 1, price: 100, timestamp: 123456, id: '1', fee: { rate: 0.1 } },
        { amount: 2, price: 200, timestamp: 123457, id: '2' },
      ]);
    });

    it('should handle empty arrays', () => {
      expect(mapToTrades([])).toEqual([]);
    });
  });

  describe('mapToOrder', () => {
    it('should pick expected order fields', () => {
      const order = {
        id: '42',
        status: 'open',
        filled: 1,
        remaining: 2,
        price: 123.45,
        timestamp: 67890,
        extra: 'ignore',
      };

      expect(mapToOrder(order)).toEqual({
        id: '42',
        status: 'open',
        filled: 1,
        remaining: 2,
        price: 123.45,
        timestamp: 67890,
      });
    });
  });
});
