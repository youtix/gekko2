import { STARTEGY_ADVICE_EVENT } from '@plugins/plugin.const';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Advice } from '../../models/types/advice.types';
import { RSI } from './rsi.strategy';

vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    period: 14,
    src: 'close',
    thresholds: { high: 70, low: 30, persistence: 2 },
  }));
  return { config: new Configuration() };
});

describe('RSI Strategy', () => {
  let strategy: RSI;
  let rsi: any;
  let advices: string[];

  beforeEach(() => {
    strategy = new RSI('RSI', 60, 0);

    // Mock indicator
    rsi = { onNewCandle: vi.fn(), getResult: vi.fn() };
    strategy['indicators'] = [rsi];
    strategy['isWarmupCompleted'] = true;
    strategy['candle'] = { start: Date.now(), open: 1, high: 2, low: 0, close: 1, volume: 100 };

    advices = [];
    strategy['on'](STARTEGY_ADVICE_EVENT, (advice: Advice) => advices.push(advice.recommendation));
  });

  it('should not emit advice before persistence on high trend', () => {
    rsi.getResult.mockReturnValue(75);
    strategy['onCandleAfterWarmup']();
    expect(advices).toHaveLength(0);
  });

  it('should emit short advice after persistence on high trend', () => {
    rsi.getResult.mockReturnValue(75);
    strategy['onCandleAfterWarmup']();
    strategy['onCandleAfterWarmup']();
    expect(advices).toEqual(['short']);
  });

  it('should emit long advice after persistence on low trend', () => {
    rsi.getResult.mockReturnValue(20);
    strategy['onCandleAfterWarmup']();
    strategy['onCandleAfterWarmup']();
    expect(advices).toEqual(['long']);
  });

  it('should reset trend when switching from high to low', () => {
    rsi.getResult.mockReturnValue(75);
    strategy['onCandleAfterWarmup']();
    strategy['onCandleAfterWarmup']();

    rsi.getResult.mockReturnValue(20);
    strategy['onCandleAfterWarmup']();
    strategy['onCandleAfterWarmup']();

    expect(advices).toEqual(['short', 'long']);
  });
});
