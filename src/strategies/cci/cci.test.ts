import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
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
  let bucket: CandleBucket;

  beforeEach(() => {
    strategy = new CCI();
    advices = [];

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });

    tools = {
      strategyParams: { period: 14, thresholds: { up: 100, down: -100, persistence: 2 } },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };

    bucket = new Map();
    bucket.set('BTC/USDT', { start: Date.now(), open: 1, high: 2, low: 0, close: 1, volume: 100 } as any);

    strategy.init({ candle: bucket, tools, addIndicator: vi.fn() } as any);
  });

  it('should not emit advice before persistence on overbought', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 150);
    expect(advices).toHaveLength(0);
  });

  it('should emit short advice after persistence on overbought', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 150);
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 150);
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1, symbol: 'BTC/USDT' }]);
  });

  it('should emit long advice after persistence on oversold', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, -150);
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, -150);
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol: 'BTC/USDT' }]);
  });

  it('should reset trend when switching from overbought to oversold', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 150);
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, 150);

    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, -150);
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, -150);

    expect(advices).toEqual([
      { type: 'STICKY', side: 'SELL', amount: 1, symbol: 'BTC/USDT' },
      { type: 'STICKY', side: 'BUY', amount: 1, symbol: 'BTC/USDT' },
    ]);
  });

  it('should do nothing when CCI result is invalid', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as any, null);
    expect(advices).toHaveLength(0);
  });
});
