import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RSI } from './rsi.strategy';

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
  let advices: string[];
  let tools: any;

  beforeEach(() => {
    strategy = new RSI();
    advices = [];
    tools = {
      candle: { close: 1 },
      strategyParams: { period: 14, src: 'close', thresholds: { high: 70, low: 30, persistence: 2 } },
      advice: (direction: string) => advices.push(direction),
      log: vi.fn(),
    };
  });

  it('should not emit advice before persistence on high trend', () => {
    strategy.onCandleAfterWarmup(tools, 75);
    expect(advices).toHaveLength(0);
  });

  it('should emit short advice after persistence on high trend', () => {
    strategy.onCandleAfterWarmup(tools, 75);
    strategy.onCandleAfterWarmup(tools, 75);
    expect(advices).toEqual(['short']);
  });

  it('should emit long advice after persistence on low trend', () => {
    strategy.onCandleAfterWarmup(tools, 20);
    strategy.onCandleAfterWarmup(tools, 20);
    expect(advices).toEqual(['long']);
  });

  it('should reset trend when switching from high to low', () => {
    strategy.onCandleAfterWarmup(tools, 75);
    strategy.onCandleAfterWarmup(tools, 75);
    strategy.onCandleAfterWarmup(tools, 20);
    strategy.onCandleAfterWarmup(tools, 20);
    expect(advices).toEqual(['short', 'long']);
  });
});
