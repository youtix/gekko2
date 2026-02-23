import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RSI } from './rsi.strategy';
import { RSIStrategyParams } from './rsi.types';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    period: 14,
    src: 'close',
    thresholds: { high: 70, low: 30, persistence: 2 },
  }));
  return { config: new Configuration() };
});

const symbol = 'BTC/USDT';

describe('RSI Strategy', () => {
  let strategy: RSI;
  let advices: AdviceOrder[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  beforeEach(() => {
    strategy = new RSI();
    advices = [];
    addIndicator = vi.fn();

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });

    tools = {
      strategyParams: { period: 14, src: 'close', thresholds: { high: 70, low: 30, persistence: 2 } },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };

    bucket = new Map();
    bucket.set(symbol, { close: 1 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<RSIStrategyParams>);
  });

  describe('init', () => {
    it('should add RSI indicator with strategy period and src', () => {
      expect(addIndicator).toHaveBeenCalledWith('RSI', symbol, { period: 14, src: 'close' });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new RSI();
      emptyStrategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      expect(advices).toHaveLength(0);
    });

    it.each`
      rsiRes
      ${undefined}
      ${null}
      ${'invalid'}
    `('should do nothing when RSI result is invalid ($rsiRes)', ({ rsiRes }) => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: rsiRes,
        symbol,
      });
      expect(advices).toHaveLength(0);
    });

    it('should not emit advice before persistence on high trend', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      expect(advices).toHaveLength(0);
    });

    it('should emit short advice after persistence on high trend', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1, symbol }]);
    });

    it('should not emit multiple short advices while high trend continues', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      expect(advices).toHaveLength(1);
    });

    it('should emit long advice after persistence on low trend', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 20,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 20,
        symbol,
      });
      expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol }]);
    });

    it('should not emit multiple long advices while low trend continues', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 20,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 20,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 20,
        symbol,
      });
      expect(advices).toHaveLength(1);
    });

    it('should reset trend when switching from high to low', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 75,
        symbol,
      });

      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 20,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 20,
        symbol,
      });

      expect(advices).toEqual([
        { type: 'STICKY', side: 'SELL', amount: 1, symbol },
        { type: 'STICKY', side: 'BUY', amount: 1, symbol },
      ]);
    });

    it('should handle neutral values by not accumulating duration', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 50,
        symbol,
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<RSIStrategyParams>, {
        results: 50,
        symbol,
      });
      expect(advices).toHaveLength(0);
    });
  });
});
