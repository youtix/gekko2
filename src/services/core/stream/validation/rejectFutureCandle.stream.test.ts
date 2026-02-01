import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RejectFutureCandleStream } from './rejectFutureCandle.stream';

// Mocks
vi.mock('@services/logger', () => ({
  warning: vi.fn(),
}));

vi.mock('@utils/date/date.utils', () => ({
  toISOString: vi.fn(d => `ISO(${d})`),
}));

vi.mock('@constants/time.const', () => ({
  ONE_MINUTE: 60000,
}));

describe('RejectFutureCandleStream', () => {
  let stream: RejectFutureCandleStream;
  const symbol = 'BTC/USDT';
  const now = 1600000000000;

  beforeEach(() => {
    stream = new RejectFutureCandleStream();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const validCandle: Candle = { start: now - 60000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 };

  const createBucket = (pair: string, c: Candle | null): CandleBucket => {
    const bucket: CandleBucket = new Map();
    if (c) bucket.set(pair as any, c);
    return bucket;
  };

  it('should pass null/empty buckets through (or handle gracefully)', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket = createBucket(symbol, null); // Empty bucket
    stream.write(bucket);

    // Implementation swallows empty buckets
    expect(dataFn).not.toHaveBeenCalled();
  });

  it('should pass past/current candles', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket = createBucket(symbol, validCandle);
    stream.write(bucket);

    expect(dataFn).toHaveBeenCalledWith(bucket);
    expect(warning).not.toHaveBeenCalled();
  });

  it('should reject future candles', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // Candle starts at now, ends at now + 60000 (future)
    const futureCandle = { ...validCandle, start: now };
    const bucket = createBucket(symbol, futureCandle);

    stream.write(bucket);

    expect(dataFn).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('stream', expect.stringContaining('Rejecting future bucket'));
  });

  it('should catch and forward errors', async () => {
    vi.useRealTimers();
    const errorFn = vi.fn();
    stream.on('error', errorFn);

    const badCandle = {
      get start() {
        throw new Error('Property Access Error');
      },
    } as any;

    const bucket = createBucket(symbol, badCandle);
    stream.write(bucket);

    // Wait for async _transform
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(errorFn).toHaveBeenCalledWith(expect.any(Error));
  });
});
