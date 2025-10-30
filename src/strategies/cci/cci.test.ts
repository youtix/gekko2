import type { AdviceOrder } from '@models/advice.types';
import type { UUID } from 'node:crypto';
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
  let advices: AdviceOrder[];
  let tools: any;

  beforeEach(() => {
    strategy = new CCI();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, quantity: order.quantity ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = {
      candle: { start: Date.now(), open: 1, high: 2, low: 0, close: 1, volume: 100 },
      strategyParams: { period: 14, thresholds: { up: 100, down: -100, persistence: 2 } },
      createOrder,
      cancelOrder: vi.fn(),
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
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', quantity: 1 }]);
  });

  it('should emit long advice after persistence on oversold', () => {
    strategy.onCandleAfterWarmup(tools, -150);
    strategy.onCandleAfterWarmup(tools, -150);
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', quantity: 1 }]);
  });

  it('should reset trend when switching from overbought to oversold', () => {
    strategy.onCandleAfterWarmup(tools, 150);
    strategy.onCandleAfterWarmup(tools, 150);

    strategy.onCandleAfterWarmup(tools, -150);
    strategy.onCandleAfterWarmup(tools, -150);

    expect(advices).toEqual([
      { type: 'STICKY', side: 'SELL', quantity: 1 },
      { type: 'STICKY', side: 'BUY', quantity: 1 },
    ]);
  });

  it('should do nothing when CCI result is invalid', () => {
    strategy.onCandleAfterWarmup(tools, null);
    expect(advices).toHaveLength(0);
  });
});
