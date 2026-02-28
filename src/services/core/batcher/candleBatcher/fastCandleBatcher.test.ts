import { Candle } from '@models/candle.types';
import { describe, expect, it } from 'vitest';
import { FastCandleBatcher } from './fastCandleBatcher';

// Helper to create candles
const createCandle = (override: Partial<Candle> = {}): Candle => ({
  start: 0,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 1000,
  ...override,
});

describe('FastCandleBatcher', () => {
  describe('Aggregation Logic', () => {
    it('should initialize accumulator with the first candle', () => {
      const batcher = new FastCandleBatcher(5);
      const candle = createCandle({ start: new Date('2023-01-01T00:01:00Z').getTime() });

      const result = batcher.addCandle(candle);

      expect(result).toBeNull();
    });

    it('should aggregate OHLCV correctly over multiple candles', () => {
      // 5 minute batcher
      const batcher = new FastCandleBatcher(5);
      const startTime = new Date('2023-01-01T00:00:00Z').getTime();

      const c1 = createCandle({ start: startTime, open: 10, high: 12, low: 9, close: 11, volume: 100 });
      const c2 = createCandle({ start: startTime + 60000, open: 11, high: 15, low: 11, close: 14, volume: 200 }); // 00:01
      const c3 = createCandle({ start: startTime + 120000, open: 14, high: 14, low: 8, close: 9, volume: 150 }); // 00:02
      const c4 = createCandle({ start: startTime + 180000, open: 9, high: 10, low: 9, close: 10, volume: 50 }); // 00:03
      const c5 = createCandle({ start: startTime + 240000, open: 10, high: 11, low: 10, close: 11, volume: 100 }); // 00:04

      batcher.addCandle(c1);
      batcher.addCandle(c2);
      batcher.addCandle(c3);
      batcher.addCandle(c4);
      const result = batcher.addCandle(c5);

      expect(result).not.toBeNull();
      expect(result).toEqual({
        start: startTime,
        open: 10, // Open of the first
        high: 15, // Max high
        low: 8, // Min low
        close: 11, // Close of the last
        volume: 600, // Sum of volumes
      });
    });

    it('should reset accumulator after emission', () => {
      const batcher = new FastCandleBatcher(5);
      const t1 = new Date('2023-01-01T00:04:00Z').getTime();
      const t2 = new Date('2023-01-01T00:09:00Z').getTime();

      // First batch
      batcher.addCandle(createCandle({ start: t1, open: 1, close: 1 }));
      // New candle (start of next batch, though this test simplifies it by just checking adding logic)
      // Wait, logic: addCandle -> check if ready -> return.
      // If we add a candle that triggers readiness, it returns result and sets this.accumulator = null.

      // Next candle added should be the start of a new accumulator.
      const c2 = createCandle({ start: t2, open: 2, close: 2 });
      const result2 = batcher.addCandle(c2); // This triggers the second batch (00:05-00:09 end at 09)

      expect(result2).not.toBeNull();
      expect(result2?.open).toBe(2); // Should be start of new batch
    });
  });

  describe('Timeframe Triggers', () => {
    // 1. Minute based (< 60)
    it('should trigger 5m candle correctly', () => {
      const batcher = new FastCandleBatcher(5);
      // Not ready
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-01T00:03:00Z').getTime() }))).toBeNull();
      // Ready (minute % 5 === 4)
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-01T00:04:00Z').getTime() }))).not.toBeNull();
    });

    // 2. Hour based (< 1440) -> e.g. 60m (1h), 240m (4h)
    it('should trigger 1h (60m) candle on minute 59', () => {
      const batcher = new FastCandleBatcher(60);
      // 00:58
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-01T00:58:00Z').getTime() }))).toBeNull();
      // 00:59
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-01T00:59:00Z').getTime() }))).not.toBeNull();
    });

    it('should trigger 4h (240m) candle correctly', () => {
      // 240 / 60 = 4 hours. hour % 4 === 3. minute === 59.
      const batcher = new FastCandleBatcher(240);

      // 02:59 -> hour 2. 2 % 4 = 2 (not 3).
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-01T02:59:00Z').getTime() }))).toBeNull();

      // 03:59 -> hour 3. 3 % 4 = 3 (match).
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-01T03:59:00Z').getTime() }))).not.toBeNull();
    });

    // 3. Daily (< 10080) -> 1440
    it('should trigger 1d (1440m) candle on 23:59', () => {
      const batcher = new FastCandleBatcher(1440);
      // 23:58
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-01T23:58:00Z').getTime() }))).toBeNull();
      // 23:59
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-01T23:59:00Z').getTime() }))).not.toBeNull();
    });

    // 4. Weekly (10080) -> Sunday 23:59
    it('should trigger 1w (10080m) candle on Sunday 23:59', () => {
      const batcher = new FastCandleBatcher(10080);

      // Saturday Jan 7 2023 -> not ready
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-07T23:59:00Z').getTime() }))).toBeNull();

      // Sunday Jan 8 2023 -> ready
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-08T23:59:00Z').getTime() }))).not.toBeNull();
    });

    // 5. Monthly (43200) -> Month End
    it('should trigger 1M (43200m) candle on month end', () => {
      const batcher = new FastCandleBatcher(43200);

      // Jan 30 -> Not end
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-30T23:59:00Z').getTime() }))).toBeNull();

      // Jan 31 -> End
      expect(batcher.addCandle(createCandle({ start: new Date('2023-01-31T23:59:00Z').getTime() }))).not.toBeNull();

      // Feb 28 (on non-leap year 2023) -> End
      expect(batcher.addCandle(createCandle({ start: new Date('2023-02-28T23:59:00Z').getTime() }))).not.toBeNull();
    });

    // 6. Quarterly (129600) -> (month+1)%3==0 && Match End
    // Months: 3, 6, 9, 12 (Indices 2, 5, 8, 11)
    it('should trigger 3M (129600m) candle on quarter end', () => {
      const batcher = new FastCandleBatcher(129600);

      // Feb 28 -> Month End, but month index 1. (1+1)%3 = 2 != 0.
      expect(batcher.addCandle(createCandle({ start: new Date('2023-02-28T23:59:00Z').getTime() }))).toBeNull();

      // Mar 31 -> Month index 2. (2+1)%3 = 0. Match.
      expect(batcher.addCandle(createCandle({ start: new Date('2023-03-31T23:59:00Z').getTime() }))).not.toBeNull();
    });

    // 7. Semi-annual (259200) -> [5, 11] (Jun, Dec)
    it('should trigger 6M (259200m) candle on semester end', () => {
      const batcher = new FastCandleBatcher(259200);

      // Mar 31 -> Month 2. Not in [5, 11]
      expect(batcher.addCandle(createCandle({ start: new Date('2023-03-31T23:59:00Z').getTime() }))).toBeNull();

      // Jun 30 -> Month 5. Matches.
      expect(batcher.addCandle(createCandle({ start: new Date('2023-06-30T23:59:00Z').getTime() }))).not.toBeNull();

      // Dec 31 -> Month 11. Matches.
      expect(batcher.addCandle(createCandle({ start: new Date('2023-12-31T23:59:00Z').getTime() }))).not.toBeNull();
    });

    // 8. Yearly (518400) -> Dec 31
    it('should trigger 1Y (518400m) candle on year end', () => {
      const batcher = new FastCandleBatcher(518400);

      // Jun 30 -> Not year end
      expect(batcher.addCandle(createCandle({ start: new Date('2023-06-30T23:59:00Z').getTime() }))).toBeNull();

      // Dec 31 -> Year end
      expect(batcher.addCandle(createCandle({ start: new Date('2023-12-31T23:59:00Z').getTime() }))).not.toBeNull();
    });
  });
});
