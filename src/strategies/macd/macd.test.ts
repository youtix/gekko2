import type { AdviceOrder } from '@models/advice.types';
import type { UUID } from 'node:crypto';
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
  let advices: AdviceOrder[];
  let tools: any;

  beforeEach(() => {
    strategy = new MACD();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = {
      candle: { close: 1 },
      strategyParams: {
        short: 12,
        long: 26,
        signal: 9,
        macdSrc: 'macd',
        thresholds: { up: 0.5, down: -0.5, persistence: 2 },
      },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };
  });

  it('should not emit advice before persistence on uptrend', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: 1, signal: 0, hist: 0 });
    expect(advices).toHaveLength(0);
  });

  it('should emit long advice after persistence on uptrend', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: 1, signal: 0, hist: 0 });
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: 1, signal: 0, hist: 0 });
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1 }]);
  });

  it('should emit short advice after persistence on downtrend', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: -1, signal: 0, hist: 0 });
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: -1, signal: 0, hist: 0 });
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1 }]);
  });

  it('should reset trend when switching from up to down', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: 1, signal: 0, hist: 0 });
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: 1, signal: 0, hist: 0 });
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: -1, signal: 0, hist: 0 });
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, { macd: -1, signal: 0, hist: 0 });
    expect(advices).toEqual([
      { type: 'STICKY', side: 'BUY', amount: 1 },
      { type: 'STICKY', side: 'SELL', amount: 1 },
    ]);
  });

  it('should do nothing when MACD result is invalid', () => {
    strategy.onTimeframeCandleAfterWarmup({ candle: tools.candle, tools } as any, null);
    expect(advices).toHaveLength(0);
  });
});
