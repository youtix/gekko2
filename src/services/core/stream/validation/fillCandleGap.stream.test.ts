import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FillCandleGapStream } from './fillCandleGap.stream';

// Mocks
vi.mock('@services/logger', () => ({
  warning: vi.fn(),
}));

vi.mock('@utils/candle/candle.utils', () => ({
  createEmptyCandle: vi.fn(lastCandle => ({
    ...lastCandle,
    start: lastCandle.start + 60000,
    volume: 0,
  })),
}));

vi.mock('@utils/date/date.utils', () => ({
  toISOString: vi.fn(date => `ISO(${date})`),
}));

vi.mock('@constants/time.const', () => ({
  ONE_MINUTE: 60000,
}));

describe('FillCandleGapStream', () => {
  let stream: FillCandleGapStream;
  const symbol = 'BTC/USDT';
  const start = 1000000;
  const candle: Candle = { start, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 };

  beforeEach(() => {
    stream = new FillCandleGapStream();
  });

  const createBucket = (pair: string, c: Candle | null): CandleBucket => {
    const bucket: CandleBucket = new Map();
    if (c) bucket.set(pair as any, c);
    return bucket;
  };

  it('should pass the first candle through and initialize state', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket = createBucket(symbol, candle);
    stream.write(bucket);

    expect(dataFn).toHaveBeenCalledWith(bucket);
    expect(dataFn).toHaveBeenCalledTimes(1);
  });

  it('should ignore initialization if candle is missing', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const bucket = createBucket(symbol, null);
    stream.write(bucket);

    // It pushes the bucket regardless if it's the first one
    expect(dataFn).toHaveBeenCalledWith(bucket);
  });

  it('should fill gap when candle is missing after initialization', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // Initialize
    stream.write(createBucket(symbol, candle));

    // Simulate gap: send candle 2 minutes later (missing t+1m)
    const gapCandle = { ...candle, start: start + 120000 }; // +2 mins
    stream.write(createBucket(symbol, gapCandle));

    expect(createEmptyCandle).toHaveBeenCalledWith(candle);
    expect(warning).toHaveBeenCalled();

    // Check emitted events:
    // 1. Initial candle
    // 2. Filled synthetic candle (t+1m)
    // 3. Current candle (t+2m)
    expect(dataFn).toHaveBeenCalledTimes(3);

    // Verify 2nd call is the filled candle
    const filledCall = dataFn.mock.calls[1][0];
    const filledAndle = filledCall.get(symbol);
    expect(filledAndle).toMatchObject({ start: start + 60000, volume: 0 });
  });

  it('should pass normal sequential candles', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);
    const nextCandle = { ...candle, start: start + 60000 };

    stream.write(createBucket(symbol, candle));
    stream.write(createBucket(symbol, nextCandle));

    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(dataFn).toHaveBeenLastCalledWith(createBucket(symbol, nextCandle));
    expect(createEmptyCandle).not.toHaveBeenCalled();
  });

  it('should propagate errors', async () => {
    const errorFn = vi.fn();
    stream.on('error', errorFn);

    // Initialize with a candle that triggers an error when its start property is accessed
    const badCandle = {
      get start() {
        throw new Error('Property Access Error');
      },
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 100,
    } as any;

    const bucket = createBucket(symbol, badCandle);
    stream.write(bucket); // should initialize lastBucket with badCandle

    // Send another bucket to trigger gap check logic which accesses badCandle.start
    // Actually, logic: `lastCandle.start + ONE_MINUTE`.
    // this.lastBucket.values().next().value gets badCandle.
    // badCandle.start throws.
    stream.write(createBucket(symbol, { ...candle, start: start + 60000 }));

    // Wait for async _transform
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(errorFn).toHaveBeenCalledWith(expect.any(Error));
  });
});
