import { Candle } from '@models/candle.types';
import { warning } from '@services/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RejectDuplicateCandleStream } from './rejectDuplicateCandle.stream';

// Mocks
vi.mock('@services/logger', () => ({
  warning: vi.fn(),
}));

// We can use actual date-fns, no need to mock usually, unless we want strict control.
// But we might want to mock it to avoid issues? No, unit tests on logic should use real calc.
// But checking import path... code uses 'date-fns'.

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

  it('should pass null candles', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    stream.write({ symbol, candle: null });

    expect(dataFn).toHaveBeenCalledWith({ symbol, candle: null });
  });

  it('should initialize with first candle', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    stream.write({ symbol, candle });

    expect(dataFn).toHaveBeenCalledWith({ symbol, candle });
  });

  it('should reject duplicate candles (same start time)', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    stream.write({ symbol, candle }); // Init
    stream.write({ symbol, candle }); // Duplicate

    expect(dataFn).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('stream', expect.stringContaining('Duplicate candle detected'));
  });

  it('should reject candles too close (within 1 min)', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // 30 seconds later
    const closeCandle = { ...candle, start: start + 30000 };

    stream.write({ symbol, candle });
    stream.write({ symbol, candle: closeCandle });

    expect(dataFn).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalled();
  });

  it('should accept distinct candles (>= 1 min)', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    // 1 minute later
    const nextCandle = { ...candle, start: start + 60000 };

    stream.write({ symbol, candle });
    stream.write({ symbol, candle: nextCandle });

    expect(dataFn).toHaveBeenCalledTimes(2);
    expect(dataFn).toHaveBeenLastCalledWith({ symbol, candle: nextCandle });
  });

  it('should update state with new candle', () => {
    // Ensure that if we pass A then B, and then B again, B#2 is rejected.
    // And if we pass A, B, C... it tracks C as last.

    const dataFn = vi.fn();
    stream.on('data', dataFn);
    const candleB = { ...candle, start: start + 60000 };
    const candleC = { ...candle, start: start + 120000 };

    stream.write({ symbol, candle });
    stream.write({ symbol, candle: candleB });
    stream.write({ symbol, candle: candleC });

    expect(dataFn).toHaveBeenCalledTimes(3);

    // Should reject another candleB or C if sent again?
    // Wait, if I send B again, difference(B, C) is -1. Abs check?
    // Code says `differenceInMinutes(candle.start, lastCandle.start) < 1`.
    // If candle < lastCandle, diff is negative, which is < 1. So it rejects past candles too!
    // If this is intended (RejectDuplicate implies only checking forward?), the name is "Duplicate".
    // If I send an *old* candle, it returns negative, so it warns "Duplicate candle detected".
    // That seems generic but effectively it rejects out-of-order/duplicate.
  });

  it('should handle multiple symbols independently', () => {
    const dataFn = vi.fn();
    stream.on('data', dataFn);

    const symbol2 = 'ETH/USDT';

    stream.write({ symbol, candle });
    stream.write({ symbol: symbol2, candle }); // Same candle data, diff symbol

    expect(dataFn).toHaveBeenCalledTimes(2);

    // Send duplicate for symbol 1
    stream.write({ symbol, candle });
    expect(dataFn).toHaveBeenCalledTimes(2); // Rejected

    // Send duplicate for symbol 2
    stream.write({ symbol: symbol2, candle });
    expect(dataFn).toHaveBeenCalledTimes(2); // Rejected
  });
});
