import type { AdviceOrder } from '@models/advice.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TMA } from './tma.strategy';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({ short: 3, medium: 5, long: 8 }));
  return { config: new Configuration() };
});

describe('TMA Strategy', () => {
  let strategy: TMA;
  let advices: AdviceOrder[];
  let tools: any;

  beforeEach(() => {
    strategy = new TMA();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = {
      candle: { close: 1 },
      strategyParams: { short: 3, medium: 5, long: 8 },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };
  });

  it('should emit long advice when short > medium > long', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, 10, 5, 2);
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1 }]);
  });

  it('should emit short advice when short < medium and medium > long', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, 3, 5, 2);
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1 }]);
  });

  it('should emit short advice when short > medium and medium < long', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, 5, 3, 7);
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1 }]);
  });

  it('should not emit advice when no clear trend', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, 5, 5, 5);
    expect(advices).toHaveLength(0);
  });
});
