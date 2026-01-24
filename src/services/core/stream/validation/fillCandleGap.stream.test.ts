import { Candle } from '@models/candle.types';
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

  it('should pass the first candle through and initialize state', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    stream.write({ symbol, candle });

    expect(dataFn).toHaveBeenCalledWith({ symbol, candle });
    expect(dataFn).toHaveBeenCalledTimes(1);
  });

  it('should ignore initialization if candle is missing', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    stream.write({ symbol, candle: null });

    expect(dataFn).not.toHaveBeenCalled();
  });

  it('should fill gap when candle is missing after initialization', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // Initialize
    stream.write({ symbol, candle });

    // Simulate gap
    stream.write({ symbol, candle: null });

    expect(createEmptyCandle).toHaveBeenCalledWith(candle);
    expect(warning).toHaveBeenCalledTimes(2); // Two warnings as per code

    // Check synthetic candle
    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(dataFn).toHaveBeenLastCalledWith({
      symbol,
      candle: expect.objectContaining({ start: start + 60000, volume: 0 }),
    });
  });

  it('should pass normal sequential candles', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);
    const nextCandle = { ...candle, start: start + 60000 };

    stream.write({ symbol, candle });
    stream.write({ symbol, candle: nextCandle });

    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(dataFn).toHaveBeenLastCalledWith({ symbol, candle: nextCandle });
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

    stream.write({ symbol, candle: badCandle }); // Sets lastCandle = badCandle

    // Trigger gap logic: !candle -> true
    // Logic: warning(..., lastCandle.start + ONE_MINUTE) -> Errors!
    stream.write({ symbol, candle: null });

    // Wait for async _transform
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(errorFn).toHaveBeenCalledWith(expect.any(Error));
  });
});
