import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
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
  let bucket: CandleBucket;

  beforeEach(() => {
    strategy = new DEMA();
    advices = [];

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });

    tools = {
      strategyParams: { period: 14, thresholds: { up: 0.5, down: -0.5 } },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };

    bucket = new Map();
    bucket.set('BTC/USDT', { close: 1 } as any);

    // Initialize strategy to set pair
    strategy.init({ candle: bucket, tools, addIndicator: vi.fn() } as any);
  });

  it('should do nothing when results are not numbers', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, undefined, undefined);
    expect(advices).toHaveLength(0);
  });

  it('should emit long advice when SMA - DEMA > up threshold', () => {
    // Diff = 2 - 1 = 1 > 0.5 (up)
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 1, 2);
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol: 'BTC/USDT' }]);
  });

  it('should emit short advice when SMA - DEMA < down threshold', () => {
    // Diff = 0 - 1 = -1 < -0.5 (down)
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 1, 0);
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1, symbol: 'BTC/USDT' }]);
  });

  it('should not re-advise on continued trend', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 1, 2);
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 1, 2);
    expect(advices).toHaveLength(1);
  });
});
