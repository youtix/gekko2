import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Advice } from '../../models/types/advice.types';
import { MACD } from './macd.strategy';

vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    short: 12,
    long: 26,
    signal: 9,
    thresholds: { up: 0.5, down: -0.5, persistence: 2 },
  }));
  return { config: new Configuration() };
});

describe('MACD Strategy', () => {
  let strategy: MACD;
  let macd: any;
  let advices: string[];

  beforeEach(() => {
    strategy = new MACD('MACD', 60, 0);

    // Replace the MACD indicator with a mock
    macd = { onNewCandle: vi.fn(), getResult: vi.fn() };
    strategy['indicators'] = [macd];

    // Bypass warmup
    strategy['isWarmupCompleted'] = true;
    strategy['candle'] = { start: Date.now(), open: 1, high: 2, low: 0, close: 1, volume: 100 };

    advices = [];
    strategy['on']('advice', (advice: Advice) => advices.push(advice.recommendation));
  });

  it('should not emit advice before persistence on uptrend', () => {
    // First candle above up threshold
    macd.getResult.mockReturnValue({ macd: 1 });
    strategy['onCandleAfterWarmup']();
    expect(advices).toHaveLength(0);
  });

  it('should emits long advice after persistence on uptrend', () => {
    // Two consecutive candles above up threshold => persistence = 2
    macd.getResult.mockReturnValue({ macd: 1 });
    strategy['onCandleAfterWarmup'](); // duration=1
    strategy['onCandleAfterWarmup'](); // duration=2, persisted -> advice

    expect(advices).toHaveLength(1);
    expect(advices[0]).toBe('long');
  });

  it('should not re-advise on continued uptrend', () => {
    // Advice once, then continued uptrend should not emit again
    macd.getResult.mockReturnValue({ macd: 1 });
    strategy['onCandleAfterWarmup'](); // 1
    strategy['onCandleAfterWarmup'](); // adviced
    strategy['onCandleAfterWarmup'](); // no new advice

    expect(advices).toHaveLength(1);
  });

  it('should emits short advice after persistence on downtrend', () => {
    // Two consecutive candles below down threshold => persistence = 2
    macd.getResult.mockReturnValue({ macd: -1 });
    strategy['onCandleAfterWarmup'](); // duration=1
    strategy['onCandleAfterWarmup'](); // duration=2, persisted -> advice

    expect(advices).toHaveLength(1);
    expect(advices[0]).toBe('short');
  });

  it('should resets trend when switching from up to down', () => {
    // Build an uptrend and get advised
    macd.getResult.mockReturnValue({ macd: 1 });
    strategy['onCandleAfterWarmup'](); // up1
    strategy['onCandleAfterWarmup'](); // up2 -> long

    // Now a downtrend
    macd.getResult.mockReturnValue({ macd: -1 });
    strategy['onCandleAfterWarmup'](); // down1, no new advice yet
    strategy['onCandleAfterWarmup'](); // down2 -> short

    expect(advices).toEqual(['long', 'short']);
  });

  it('should nothing when MACD result is invalid', () => {
    macd.getResult.mockReturnValue(null);
    strategy['onCandleAfterWarmup']();
    expect(advices).toHaveLength(0);
  });
});
