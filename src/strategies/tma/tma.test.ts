import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TMA } from './tma.strategy';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({ short: 3, medium: 5, long: 8 }));
  return { config: new Configuration() };
});

describe('TMA Strategy', () => {
  let strategy: TMA;
  let advices: string[];
  let tools: any;

  beforeEach(() => {
    strategy = new TMA();
    advices = [];
    tools = {
      candle: { close: 1 },
      strategyParams: { short: 3, medium: 5, long: 8 },
      advice: (dir: string) => advices.push(dir),
      log: vi.fn(),
    };
  });

  it('should emit long advice when short > medium > long', () => {
    strategy.onCandleAfterWarmup(tools, 10, 5, 2);
    expect(advices).toEqual(['long']);
  });

  it('should emit short advice when short < medium and medium > long', () => {
    strategy.onCandleAfterWarmup(tools, 3, 5, 2);
    expect(advices).toEqual(['short']);
  });

  it('should emit short advice when short > medium and medium < long', () => {
    strategy.onCandleAfterWarmup(tools, 5, 3, 7);
    expect(advices).toEqual(['short']);
  });

  it('should not emit advice when no clear trend', () => {
    strategy.onCandleAfterWarmup(tools, 5, 5, 5);
    expect(advices).toHaveLength(0);
  });
});
