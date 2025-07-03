import { STRATEGY_ADVICE_EVENT } from '@plugins/plugin.const';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Advice } from '../../models/types/advice.types';
import { CCI } from './cci.strategy';

vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    period: 14,
    thresholds: { up: 100, down: -100, persistence: 2 },
  }));
  return { config: new Configuration() };
});

describe('CCI Strategy', () => {
  let strategy: CCI;
  let cci: any;
  let advices: string[];

  beforeEach(() => {
    strategy = new CCI();
    cci = { onNewCandle: vi.fn(), getResult: vi.fn() };
    strategy['indicators'] = [cci];
    strategy['isWarmupCompleted'] = true;
    strategy['candle'] = { start: Date.now(), open: 1, high: 2, low: 0, close: 1, volume: 100 };
    advices = [];
    strategy['on'](STRATEGY_ADVICE_EVENT, (advice: Advice) => advices.push(advice.recommendation));
  });

  it('should not emit advice before persistence on overbought', () => {
    cci.getResult.mockReturnValue(150);
    strategy['onCandleAfterWarmup']();
    expect(advices).toHaveLength(0);
  });

  it('should emit short advice after persistence on overbought', () => {
    cci.getResult.mockReturnValue(150);
    strategy['onCandleAfterWarmup']();
    strategy['onCandleAfterWarmup']();
    expect(advices).toEqual(['short']);
  });

  it('should emit long advice after persistence on oversold', () => {
    cci.getResult.mockReturnValue(-150);
    strategy['onCandleAfterWarmup']();
    strategy['onCandleAfterWarmup']();
    expect(advices).toEqual(['long']);
  });

  it('should reset trend when switching from overbought to oversold', () => {
    cci.getResult.mockReturnValue(150);
    strategy['onCandleAfterWarmup']();
    strategy['onCandleAfterWarmup']();

    cci.getResult.mockReturnValue(-150);
    strategy['onCandleAfterWarmup']();
    strategy['onCandleAfterWarmup']();

    expect(advices).toEqual(['short', 'long']);
  });

  it('should do nothing when CCI result is invalid', () => {
    cci.getResult.mockReturnValue(null);
    strategy['onCandleAfterWarmup']();
    expect(advices).toHaveLength(0);
  });
});
