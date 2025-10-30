import type { AdviceOrder } from '@models/advice.types';
import type { UUID } from 'node:crypto';
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
  let advices: AdviceOrder[];
  let tools: any;

  beforeEach(() => {
    strategy = new RSI();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, quantity: order.quantity ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = {
      candle: { close: 1 },
      strategyParams: { period: 14, src: 'close', thresholds: { high: 70, low: 30, persistence: 2 } },
      createOrder,
      cancelOrder: vi.fn(),
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
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', quantity: 1 }]);
  });

  it('should emit long advice after persistence on low trend', () => {
    strategy.onCandleAfterWarmup(tools, 20);
    strategy.onCandleAfterWarmup(tools, 20);
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', quantity: 1 }]);
  });

  it('should reset trend when switching from high to low', () => {
    strategy.onCandleAfterWarmup(tools, 75);
    strategy.onCandleAfterWarmup(tools, 75);
    strategy.onCandleAfterWarmup(tools, 20);
    strategy.onCandleAfterWarmup(tools, 20);
    expect(advices).toEqual([
      { type: 'STICKY', side: 'SELL', quantity: 1 },
      { type: 'STICKY', side: 'BUY', quantity: 1 },
    ]);
  });
});
