import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RejectDuplicateCandleStream } from './rejectDuplicateCandle.stream';

// Mocks
vi.mock('@services/logger', () => ({
  warning: vi.fn(),
}));

vi.mock('@utils/date/date.utils', () => ({
  toISOString: vi.fn(d => `ISO(${d})`),
}));

describe('RejectDuplicateCandleStream', () => {
  let stream: RejectDuplicateCandleStream;
  const symbol = 'BTC/USDT';
  const start = 1600000000000;
  const candle: Candle = { start, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 };

  beforeEach(() => {
    stream = new RejectDuplicateCandleStream();
  });

  const createBucket = (pair: string, c: Candle | null): CandleBucket => {
    const bucket: CandleBucket = new Map();
    if (c) bucket.set(pair as any, c);
    return bucket;
  };

  it('should pass empty buckets (or check behavior if needed)', () => {
    // If bucket is empty, code says: const firstCandle = bucket.values().next().value; if (!firstCandle) return next();
    // So it should just swallow it? Or pass it through? Implementation calls next() without push.
    // So distinct from "pass null candles". Let's verify behavior for empty bucket.
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket = new Map() as CandleBucket;
    stream.write(bucket);

    expect(dataFn).not.toHaveBeenCalled();
  });

  it('should initialize with first candle bucket', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket = createBucket(symbol, candle);
    stream.write(bucket);

    expect(dataFn).toHaveBeenCalledWith(bucket);
  });

  it('should reject duplicate candles (same start time)', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket = createBucket(symbol, candle);
    stream.write(bucket); // Init

    // Duplicate
    // Need new map instance but same content logic
    const bucket2 = createBucket(symbol, candle);
    stream.write(bucket2);

    expect(dataFn).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('stream', expect.stringContaining('Duplicate bucket detected'));
  });

  it('should reject candles too close (within 1 min)', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // 30 seconds later
    const closeCandle = { ...candle, start: start + 30000 };

    const bucket1 = createBucket(symbol, candle);
    const bucket2 = createBucket(symbol, closeCandle);

    stream.write(bucket1);
    stream.write(bucket2);

    expect(dataFn).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalled();
  });

  it('should accept distinct candles (>= 1 min)', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // 1 minute later
    const nextCandle = { ...candle, start: start + 60000 };

    const bucket1 = createBucket(symbol, candle);
    const bucket2 = createBucket(symbol, nextCandle);

    stream.write(bucket1);
    stream.write(bucket2);

    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(dataFn).toHaveBeenLastCalledWith(bucket2);
  });

  it('should update state with new candle', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);
    const candleB = { ...candle, start: start + 60000 };
    const candleC = { ...candle, start: start + 120000 };

    stream.write(createBucket(symbol, candle));
    stream.write(createBucket(symbol, candleB));
    stream.write(createBucket(symbol, candleC));

    expect(dataFn).toHaveBeenCalledTimes(3);
  });
});
