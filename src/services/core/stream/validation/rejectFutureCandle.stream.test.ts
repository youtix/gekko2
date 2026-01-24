import { Candle } from '@models/candle.types';
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

  it('should pass null candles through', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    stream.write({ symbol, candle: null });

    expect(dataFn).toHaveBeenCalledWith({ symbol, candle: null });
  });

  it('should pass past/current candles', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // Candle ends at 'now' (start = now - 60000, end = start + 60000 = now)
    // Code: candleEndTime > Date.now()
    // now > now is false, so it passes.

    stream.write({ symbol, candle: validCandle });

    expect(dataFn).toHaveBeenCalledWith({ symbol, candle: validCandle });
    expect(warning).not.toHaveBeenCalled();
  });

  it('should reject future candles', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // Candle starts at now, ends at now + 60000 (future)
    const futureCandle = { ...validCandle, start: now };

    stream.write({ symbol, candle: futureCandle });

    expect(dataFn).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('stream', expect.stringContaining('Rejecting future candle'));
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

    stream.write({ symbol, candle: badCandle });

    // Wait for async _transform
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(errorFn).toHaveBeenCalledWith(expect.any(Error));
  });
});
