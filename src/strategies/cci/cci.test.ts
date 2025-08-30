import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CCI } from './cci.strategy';

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
  let advices: string[];
  let tools: any;

  beforeEach(() => {
    strategy = new CCI();
    advices = [];
    tools = {
      candle: { start: Date.now(), open: 1, high: 2, low: 0, close: 1, volume: 100 },
      strategyParams: { period: 14, thresholds: { up: 100, down: -100, persistence: 2 } },
      advice: (direction: string) => advices.push(direction),
      log: vi.fn(),
    };
  });

  it('should not emit advice before persistence on overbought', () => {
    strategy.onCandleAfterWarmup(tools, 150);
    expect(advices).toHaveLength(0);
  });

  it('should emit short advice after persistence on overbought', () => {
    strategy.onCandleAfterWarmup(tools, 150);
    strategy.onCandleAfterWarmup(tools, 150);
    expect(advices).toEqual(['short']);
  });

  it('should emit long advice after persistence on oversold', () => {
    strategy.onCandleAfterWarmup(tools, -150);
    strategy.onCandleAfterWarmup(tools, -150);
    expect(advices).toEqual(['long']);
  });

  it('should reset trend when switching from overbought to oversold', () => {
    strategy.onCandleAfterWarmup(tools, 150);
    strategy.onCandleAfterWarmup(tools, 150);

    strategy.onCandleAfterWarmup(tools, -150);
    strategy.onCandleAfterWarmup(tools, -150);

    expect(advices).toEqual(['short', 'long']);
  });

  it('should do nothing when CCI result is invalid', () => {
    strategy.onCandleAfterWarmup(tools, null);
    expect(advices).toHaveLength(0);
  });
});
