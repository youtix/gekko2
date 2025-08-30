import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MACD } from './macd.strategy';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    short: 12,
    long: 26,
    signal: 9,
    macdSrc: 'macd',
    thresholds: { up: 0.5, down: -0.5, persistence: 2 },
  }));
  return { config: new Configuration() };
});

describe('MACD Strategy', () => {
  let strategy: MACD;
  let advices: string[];
  let tools: any;

  beforeEach(() => {
    strategy = new MACD();
    advices = [];
    tools = {
      candle: { close: 1 },
      strategyParams: {
        short: 12,
        long: 26,
        signal: 9,
        macdSrc: 'macd',
        thresholds: { up: 0.5, down: -0.5, persistence: 2 },
      },
      advice: (direction: string) => advices.push(direction),
      log: vi.fn(),
    };
  });

  it('should not emit advice before persistence on uptrend', () => {
    strategy.onCandleAfterWarmup(tools, { macd: 1, signal: 0, hist: 0 });
    expect(advices).toHaveLength(0);
  });

  it('should emit long advice after persistence on uptrend', () => {
    strategy.onCandleAfterWarmup(tools, { macd: 1, signal: 0, hist: 0 });
    strategy.onCandleAfterWarmup(tools, { macd: 1, signal: 0, hist: 0 });
    expect(advices).toEqual(['long']);
  });

  it('should emit short advice after persistence on downtrend', () => {
    strategy.onCandleAfterWarmup(tools, { macd: -1, signal: 0, hist: 0 });
    strategy.onCandleAfterWarmup(tools, { macd: -1, signal: 0, hist: 0 });
    expect(advices).toEqual(['short']);
  });

  it('should reset trend when switching from up to down', () => {
    strategy.onCandleAfterWarmup(tools, { macd: 1, signal: 0, hist: 0 });
    strategy.onCandleAfterWarmup(tools, { macd: 1, signal: 0, hist: 0 });
    strategy.onCandleAfterWarmup(tools, { macd: -1, signal: 0, hist: 0 });
    strategy.onCandleAfterWarmup(tools, { macd: -1, signal: 0, hist: 0 });
    expect(advices).toEqual(['long', 'short']);
  });

  it('should do nothing when MACD result is invalid', () => {
    strategy.onCandleAfterWarmup(tools, null);
    expect(advices).toHaveLength(0);
  });
});
