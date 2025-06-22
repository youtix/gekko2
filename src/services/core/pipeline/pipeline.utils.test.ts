import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(),
  },
}));

process.env.GEKKO_CONFIG_FILE_PATH = path.resolve(
  new URL('.', import.meta.url).pathname,
  '../../../../config/backtest.yml',
);

import { config } from '@services/configuration/configuration';

let getOffset: typeof import('./pipeline.utils').getOffset;

describe('getOffset', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    ({ getOffset } = await import('./pipeline.utils'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('calculates offset for minute timeframe', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 1, 0, 7)));
    (config.getWatch as unknown as vi.Mock).mockReturnValue({ timeframe: '5m' });
    expect(getOffset()).toBe(2); // 7 % 5
  });

  it('calculates offset for hourly timeframe', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 1, 10, 32)));
    (config.getWatch as unknown as vi.Mock).mockReturnValue({ timeframe: '1h' });
    // 10*60 + 32 = 632 -> 632 % 60 = 32
    expect(getOffset()).toBe(32);
  });

  it('calculates offset for daily timeframe', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 15, 12, 45)));
    (config.getWatch as unknown as vi.Mock).mockReturnValue({ timeframe: '1d' });
    const expected = 12 * 60 + 45;
    expect(getOffset()).toBe(expected);
  });

  it('calculates offset for weekly timeframe', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 0, 8, 10, 0)));
    (config.getWatch as unknown as vi.Mock).mockReturnValue({ timeframe: '1w' });
    // Wednesday => weekday 3 -> ((3 + 6) % 7) = 2
    const minutesSinceMidnight = 10 * 60;
    const expected = 2 * 1440 + minutesSinceMidnight;
    expect(getOffset()).toBe(expected);
  });

  it('calculates offset for monthly timeframe', () => {
    vi.setSystemTime(new Date(Date.UTC(2025, 4, 10, 0, 0)));
    (config.getWatch as unknown as vi.Mock).mockReturnValue({ timeframe: '1M' });
    const startOfMonth = Date.UTC(2025, 4, 1);
    const expected = Math.floor((Date.UTC(2025, 4, 10) - startOfMonth) / 60000);
    expect(getOffset()).toBe(expected);
  });
});
