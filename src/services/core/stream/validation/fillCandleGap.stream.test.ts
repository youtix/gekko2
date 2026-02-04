import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FillCandleGapStream } from './fillCandleGap.stream';

// Mocks
vi.mock('@services/logger', () => ({
  warning: vi.fn(),
}));

vi.mock('@utils/candle/candle.utils', () => ({
  createEmptyCandle: vi.fn((lastCandle: Candle) => ({
    ...lastCandle,
    start: lastCandle.start + 60000,
    volume: 0,
    open: lastCandle.close,
    high: lastCandle.close,
    low: lastCandle.close,
  })),
}));

describe('FillCandleGapStream', () => {
  let stream: FillCandleGapStream;
  const eth: TradingPair = 'ETH/USDT';
  const btc: TradingPair = 'BTC/USDT';
  const pairs = [eth, btc];

  const start = 1000000;

  const ethCandle: Candle = { start, open: 100, high: 110, low: 90, close: 105, volume: 1000 };
  const btcCandle: Candle = { start, open: 20000, high: 21000, low: 19000, close: 20500, volume: 50 };

  beforeEach(() => {
    stream = new FillCandleGapStream(pairs);
    vi.clearAllMocks();
  });

  const createBucket = (timestamp?: number, candles: { pair: TradingPair; candle: Candle }[] = []): CandleBucket => {
    const bucket: CandleBucket = new Map();
    candles.forEach(({ pair, candle }) => {
      // Pair is a string, so use it directly as key
      bucket.set(pair, timestamp ? { ...candle, start: timestamp } : candle);
    });
    return bucket;
  };

  it('Complete Stream: should pass through complete buckets without modification', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket1 = createBucket(start, [
      { pair: eth, candle: ethCandle },
      { pair: btc, candle: btcCandle },
    ]);
    const bucket2 = createBucket(start + 60000, [
      { pair: eth, candle: ethCandle },
      { pair: btc, candle: btcCandle },
    ]);

    stream.write(bucket1);
    stream.write(bucket2);

    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(dataFn).toHaveBeenNthCalledWith(1, bucket1);
    expect(dataFn).toHaveBeenNthCalledWith(2, bucket2);
    expect(createEmptyCandle).not.toHaveBeenCalled();
  });

  it('Total Gap: should fill missing minutes for all assets', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // T0
    stream.write(
      createBucket(start, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // T2 (Gap at T1)
    const bucketT2 = createBucket(start + 120000, [
      { pair: eth, candle: ethCandle },
      { pair: btc, candle: btcCandle },
    ]);
    stream.write(bucketT2);

    expect(dataFn).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalled();

    // Check T1 (synthetic)
    const filledBucket = dataFn.mock.calls[1][0] as CandleBucket;
    expect(filledBucket.size).toBe(2);
    expect(filledBucket.get(eth)).toMatchObject({ start: start + 60000, volume: 0 });
    expect(filledBucket.get(btc)).toMatchObject({ start: start + 60000, volume: 0 });

    // Check T2
    expect(dataFn).toHaveBeenLastCalledWith(bucketT2);
  });

  it('Partial Gap (Start): should fill missing asset in initial bucket', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // Initial bucket only has ETH
    const initialBucket = createBucket(start, [{ pair: eth, candle: ethCandle }]);
    stream.write(initialBucket);

    expect(dataFn).toHaveBeenCalledTimes(1);
    const emittedBucket = dataFn.mock.calls[0][0] as CandleBucket;

    expect(emittedBucket.size).toBe(1);
    expect(emittedBucket.get(eth)).toBeDefined();
    // note: btc cannot be filled as initialization has no prior state
    expect(emittedBucket.get(btc)).toBeUndefined();
  });

  it('Partial Gap (Mid): should fill missing asset in a subsequent bucket', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // T0: Both assets
    stream.write(
      createBucket(start, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // T1: Only ETH
    const partialBucket = createBucket(start + 60000, [{ pair: eth, candle: ethCandle }]);
    stream.write(partialBucket);

    expect(dataFn).toHaveBeenCalledTimes(2);
    const emittedBucket = dataFn.mock.calls[1][0] as CandleBucket;

    expect(emittedBucket.size).toBe(2);
    expect(emittedBucket.get(eth)).toBeDefined(); // Real
    expect(emittedBucket.get(btc))?.toBeDefined(); // Filled
    expect(emittedBucket.get(btc)!.volume).toBe(0);
    expect(warning).toHaveBeenCalledWith('stream', expect.stringContaining(`Partial gap detected for ${btc}`));
  });

  it('Partial Gap (Intermittent): should handle assets dropping in and out', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // T0: Both
    stream.write(
      createBucket(start, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // T1: BTC missing
    stream.write(createBucket(start + 60000, [{ pair: eth, candle: ethCandle }]));

    // T2: ETH missing
    stream.write(createBucket(start + 120000, [{ pair: btc, candle: btcCandle }]));

    // T3: Both present
    stream.write(
      createBucket(start + 180000, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    expect(dataFn).toHaveBeenCalledTimes(4);

    // T1 check
    expect(dataFn.mock.calls[1][0].get(btc)?.volume).toBe(0);

    // T2 check
    expect(dataFn.mock.calls[2][0].get(eth)?.volume).toBe(0);
    expect(dataFn.mock.calls[2][0].get(btc)?.volume).toBe(50); // Real data
  });

  it('Cascading Gaps: Partial gap followed by Total gap', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // T0: Both
    stream.write(
      createBucket(start, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // T1: BTC missing (Partial)
    stream.write(createBucket(start + 60000, [{ pair: eth, candle: ethCandle }]));

    // T3: Both present (Total Gap at T2 of 1 min)
    stream.write(
      createBucket(start + 180000, [
        { pair: eth, candle: ethCandle },
        { pair: btc, candle: btcCandle },
      ]),
    );

    // Events:
    // 1. T0 (Full)
    // 2. T1 (ETH real, BTC filled)
    // 3. T2 (Synthetic fill for BOTH)
    // 4. T3 (Full)
    expect(dataFn).toHaveBeenCalledTimes(4);

    // Check T2 (Index 2)
    const t2Bucket = dataFn.mock.calls[2][0] as CandleBucket;
    expect(t2Bucket.size).toBe(2);
    expect(t2Bucket.get(eth)?.volume).toBe(0);
    expect(t2Bucket.get(btc)?.volume).toBe(0);
  });
});
