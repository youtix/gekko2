import { STARTEGY_ADVICE_EVENT } from '@plugins/plugin.const';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Advice } from '../../models/types/advice.types';
import { TMA } from './tma.strategy';

vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({ short: 3, medium: 5, long: 8 }));
  return { config: new Configuration() };
});

describe('TMA Strategy', () => {
  let strategy: TMA;
  let short: any;
  let medium: any;
  let long: any;
  let advices: string[];

  beforeEach(() => {
    strategy = new TMA('TMA', 60, 0);

    // Replace indicators with mocks to control their outputs
    short = { onNewCandle: vi.fn(), getResult: vi.fn(), getName: vi.fn(), name: '', result: 0 };
    medium = { onNewCandle: vi.fn(), getResult: vi.fn() };
    long = { onNewCandle: vi.fn(), getResult: vi.fn() };
    strategy['indicators'] = [short, medium, long];
    strategy['candle'] = { start: Date.now(), open: 1, high: 2, low: 0, close: 1, volume: 100 };

    // Bypass warmup so onCandleAfterWarmup runs
    strategy['isWarmupCompleted'] = true;

    // Capture emitted advices
    advices = [];

    strategy['on'](STARTEGY_ADVICE_EVENT, (advice: Advice) => advices.push(advice.recommendation));
  });

  it('should emits long advice when short > medium > long', () => {
    short.getResult.mockReturnValue(10);
    medium.getResult.mockReturnValue(5);
    long.getResult.mockReturnValue(2);

    strategy['onCandleAfterWarmup']();

    expect(advices).toHaveLength(1);
    expect(advices[0]).toBe('long');
  });

  it('should emits short advice when short < medium and medium > long', () => {
    short.getResult.mockReturnValue(3);
    medium.getResult.mockReturnValue(5);
    long.getResult.mockReturnValue(2);

    strategy['onCandleAfterWarmup']();

    expect(advices).toHaveLength(1);
    expect(advices[0]).toBe('short');
  });

  it('should emits short advice when short > medium and medium < long', () => {
    short.getResult.mockReturnValue(5);
    medium.getResult.mockReturnValue(3);
    long.getResult.mockReturnValue(7);

    strategy['onCandleAfterWarmup']();

    expect(advices).toHaveLength(1);
    expect(advices[0]).toBe('short');
  });

  it('should not emit advice when no clear trend', () => {
    short.getResult.mockReturnValue(5);
    medium.getResult.mockReturnValue(5);
    long.getResult.mockReturnValue(5);

    strategy['onCandleAfterWarmup']();

    expect(advices).toHaveLength(0);
  });
});
