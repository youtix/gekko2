import type { AdviceOrder } from '@models/advice.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMA } from './dema.strategy';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    period: 14,
    thresholds: { up: 0.5, down: -0.5 },
  }));
  return { config: new Configuration() };
});

describe('DEMA Strategy', () => {
  let strategy: DEMA;
  let advices: AdviceOrder[];
  let tools: any;

  beforeEach(() => {
    strategy = new DEMA();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, quantity: order.quantity ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = {
      candle: { close: 1 },
      strategyParams: { period: 14, thresholds: { up: 0.5, down: -0.5 } },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };
  });

  it('should do nothing when results are not numbers', () => {
    strategy.onCandleAfterWarmup(tools, undefined, undefined);
    expect(advices).toHaveLength(0);
  });

  it('should emit long advice when SMA - DEMA > up threshold', () => {
    strategy.onCandleAfterWarmup(tools, 1, 2);
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', quantity: 1 }]);
  });

  it('should emit short advice when SMA - DEMA < down threshold', () => {
    strategy.onCandleAfterWarmup(tools, 1, 0);
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', quantity: 1 }]);
  });

  it('should not re-advise on continued trend', () => {
    strategy.onCandleAfterWarmup(tools, 1, 2);
    strategy.onCandleAfterWarmup(tools, 1, 2);
    expect(advices).toHaveLength(1);
  });
});
