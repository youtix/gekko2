import { Candle } from '@models/candle.types';
import { TradingPair } from '@models/utility.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandleBucketBatcher } from './candleBucketBatcher';
import { FastCandleBatcher } from './fastCandleBatcher';

// Mock FastCandleBatcher using classic function to ensure `this` context is tracked in mock.instances
vi.mock('./fastCandleBatcher', () => {
  return {
    FastCandleBatcher: vi.fn(function (this: any) {
      this.addCandle = vi.fn();
    }),
  };
});

describe('CandleBucketBatcher', () => {
  const pairA: TradingPair = 'USDT/BTC';
  const pairB: TradingPair = 'USDT/ETH';
  const pairs = [pairA, pairB];
  const candleSize = 5;

  let batcher: CandleBucketBatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    batcher = new CandleBucketBatcher(pairs, candleSize);
  });

  it('should initialize correctly with given pairs', () => {
    expect(batcher.pairCount).toBe(2);
    expect(FastCandleBatcher).toHaveBeenCalledTimes(2);
    expect(FastCandleBatcher).toHaveBeenCalledWith(candleSize);
  });

  describe('addBucket', () => {
    const mockCandle = {
      start: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
      trades: 50,
    } as unknown as Candle;

    it('should throw an error if a registered pair is missing from the bucket', () => {
      const bucket = new Map([[pairA, mockCandle]]);
      expect(() => batcher.addBucket(bucket)).toThrowError(/CandleBucketBatcher: Missing candle for pair/);
    });

    it('should ignore unregistered pairs in the bucket', () => {
      // Use mock.instances now that we use function() implementation
      const mockInstances = vi.mocked(FastCandleBatcher).mock.instances as any[];

      mockInstances.forEach(instance => {
        instance.addCandle.mockReturnValue(undefined);
      });

      const bucket = new Map([
        [pairA, mockCandle],
        [pairB, mockCandle],
        ['USDT/LTC' as TradingPair, mockCandle], // Unregistered
      ]);

      const result = batcher.addBucket(bucket);

      expect(result).toBeUndefined();
      mockInstances.forEach(instance => {
        expect(instance.addCandle).toHaveBeenCalledTimes(1);
      });
    });

    it('should return undefined if not all pairs are ready', () => {
      const mockInstances = vi.mocked(FastCandleBatcher).mock.instances as any[];
      const batcherA = mockInstances[0];
      const batcherB = mockInstances[1];

      batcherA.addCandle.mockReturnValue(mockCandle);
      batcherB.addCandle.mockReturnValue(undefined);

      const bucket = new Map([
        [pairA, mockCandle],
        [pairB, mockCandle],
      ]);

      const result = batcher.addBucket(bucket);
      expect(result).toBeUndefined();
    });

    it('should return a completed bucket when all pairs are ready', () => {
      const mockInstances = vi.mocked(FastCandleBatcher).mock.instances as any[];
      const batcherA = mockInstances[0];
      const batcherB = mockInstances[1];

      batcherA.addCandle.mockReturnValue(mockCandle);
      batcherB.addCandle.mockReturnValue(mockCandle);

      const bucket = new Map([
        [pairA, mockCandle],
        [pairB, mockCandle],
      ]);

      const result = batcher.addBucket(bucket);
      expect(result).toBeDefined();
      expect(result!.size).toBe(2);
      expect(result!.get(pairA)).toBe(mockCandle);
      expect(result!.get(pairB)).toBe(mockCandle);
    });

    it('should NOT emit if synchronization is lost (one ready, one not in same step)', () => {
      const mockInstances = vi.mocked(FastCandleBatcher).mock.instances as any[];
      const batcherA = mockInstances[0];
      const batcherB = mockInstances[1];

      // Step 1: A ready, B not
      batcherA.addCandle.mockReturnValue(mockCandle);
      batcherB.addCandle.mockReturnValue(undefined);

      const bucket1 = new Map([
        [pairA, mockCandle],
        [pairB, mockCandle],
      ]);

      expect(batcher.addBucket(bucket1)).toBeUndefined();

      // Step 2: A not ready, B ready
      batcherA.addCandle.mockReturnValue(undefined);
      batcherB.addCandle.mockReturnValue(mockCandle);

      const bucket2 = new Map([
        [pairA, mockCandle],
        [pairB, mockCandle],
      ]);

      expect(batcher.addBucket(bucket2)).toBeUndefined();
    });
  });
});
