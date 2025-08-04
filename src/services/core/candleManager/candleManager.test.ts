import { describe, expect, it, vi } from 'vitest';
import { CandleManager } from './candleManager';

vi.mock('@services/logger', () => ({ debug: vi.fn() }));

type Trade = { timestamp: number; price: number; amount: number };
type Batch = { data: Trade[] };

describe('CandleManager', () => {
  it('returns an empty array when only one trade in the current minute', () => {
    const cm = new CandleManager();
    const batch: Batch = { data: [{ timestamp: 10_000, price: 100, amount: 1 }] };

    const out = cm.processBatch(batch as any);
    expect(out.length).toBe(0);
  });

  describe('minute rollover', () => {
    it('should set candle property correctly', () => {
      const cm = new CandleManager();

      const t0 = 0;
      const batch: Batch = {
        data: [
          { timestamp: t0 + 10_000, price: 100, amount: 1 },
          { timestamp: t0 + 40_000, price: 105, amount: 0.5 },
          { timestamp: t0 + 60_000 + 5_000, price: 103, amount: 2 },
        ],
      };

      const [candle] = cm.processBatch(batch as any);
      expect(candle).toEqual({ start: 0, open: 100, high: 105, low: 100, close: 105, volume: 1.5 });
    });
  });
});
