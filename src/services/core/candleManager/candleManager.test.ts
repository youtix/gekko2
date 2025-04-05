import { setMilliseconds, setSeconds } from 'date-fns';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateTrade } from '../../../models/trade.mock';
import { Batch } from '../../../models/types/batch.types';
import { Trade } from '../../../models/types/trade.types';
import { CandleManager } from './candleManager';

describe('CandleManager', () => {
  let candleManager: CandleManager;

  beforeEach(() => {
    candleManager = new CandleManager();
  });

  describe('calculateCandle', () => {
    it('should calculate a correct candle from trades', () => {
      const trades = [
        {
          timestamp: new Date('2024-06-01T00:00:00Z').getTime(),
          price: 100,
          amount: 1,
        },
        {
          timestamp: new Date('2024-06-01T00:00:30Z').getTime(),
          price: 102,
          amount: 2,
        },
      ] as Trade[];

      const result = candleManager['calculateCandle'](trades);

      expect(result).toEqual({
        start: setSeconds(setMilliseconds(new Date('2024-06-01T00:00:00Z'), 0), 0).getTime(),
        open: 100,
        high: 102,
        low: 100,
        close: 102,
        volume: 3,
      });
    });
  });

  describe('write', () => {
    it('should preserves only the last minute trades', () => {
      const batch = {
        data: [
          generateTrade({
            timestamp: new Date('2024-06-01T00:00:00Z').getTime(),
            price: 100,
            amount: 1,
          }),
          generateTrade({
            timestamp: new Date('2024-06-01T00:01:00Z').getTime(),
            price: 101,
            amount: 1,
          }),
        ],
      } as unknown as Batch;
      candleManager.processBacth(batch);

      expect(Object.keys(candleManager.lastMinuteTrades)).toEqual(['2024-06-01T00:01:00.000Z']);
    });

    it('should returns candles after processing valid trades', () => {
      const batch = {
        data: [
          { timestamp: new Date('2024-06-01T00:00:00Z').getTime(), price: 100, amount: 1 },
          { timestamp: new Date('2024-06-01T00:01:00Z').getTime(), price: 101, amount: 1 },
        ],
      } as unknown as Batch;

      const result = candleManager.processBacth(batch);

      expect(result).toEqual([
        {
          close: 100,
          high: 100,
          low: 100,
          open: 100,
          start: 1717200000000,
          volume: 1,
        },
      ]);
    });

    it('should handles empty trade batches gracefully', () => {
      const result = candleManager.processBacth({ data: new Array<Trade>() } as Batch);
      expect(result).toEqual([]);
    });
  });
});
