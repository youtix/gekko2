import { AdviceOrder } from '@models/advice.types';
import { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CCI } from './cci.strategy';
import { CCIStrategyParams } from './cci.types';

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
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  beforeEach(() => {
    strategy = new CCI();
    advices = [];
    logs = [];
    addIndicator = vi.fn();

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });

    tools = {
      strategyParams: { period: 14, thresholds: { up: 100, down: -100, persistence: 2 } },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn((level: LogLevel, message: string) => logs.push({ level, message })),
    };

    bucket = new Map();
    bucket.set('BTC/USDT', { start: Date.now(), open: 1, high: 2, low: 0, close: 10, volume: 100 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<CCIStrategyParams>);
  });

  describe('init', () => {
    it('should add CCI indicator with strategy period', () => {
      expect(addIndicator).toHaveBeenCalledWith('CCI', 'BTC/USDT', { period: 14 });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new CCI();
      emptyStrategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      expect(advices).toHaveLength(0);
    });

    it.each`
      cciRes
      ${undefined}
      ${'invalid'}
      ${null}
    `('should do nothing when CCI result is invalid ($cciRes)', ({ cciRes }) => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: cciRes,
        symbol: 'BTC/USDT',
      });
      expect(advices).toHaveLength(0);
    });

    it('should not emit advice before persistence on overbought', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      expect(advices).toHaveLength(0);
    });

    it('should emit short advice after persistence on overbought', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1, symbol: 'BTC/USDT' }]);
    });

    it('should not emit multiple short advices while overbought trend continues', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      expect(advices).toHaveLength(1);
    });

    it('should emit long advice after persistence on oversold', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: -150,
        symbol: 'BTC/USDT',
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: -150,
        symbol: 'BTC/USDT',
      });
      expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol: 'BTC/USDT' }]);
    });

    it('should not emit multiple long advices while oversold trend continues', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: -150,
        symbol: 'BTC/USDT',
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: -150,
        symbol: 'BTC/USDT',
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: -150,
        symbol: 'BTC/USDT',
      });
      expect(advices).toHaveLength(1);
    });

    it('should reset trend when switching from overbought to oversold', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });

      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: -150,
        symbol: 'BTC/USDT',
      });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: -150,
        symbol: 'BTC/USDT',
      });

      expect(advices).toEqual([
        { type: 'STICKY', side: 'SELL', amount: 1, symbol: 'BTC/USDT' },
        { type: 'STICKY', side: 'BUY', amount: 1, symbol: 'BTC/USDT' },
      ]);
    });

    it('should handle nodirection and accumulate duration correctly', () => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 50,
        symbol: 'BTC/USDT',
      });
      expect(logs).toContainEqual({ level: 'debug', message: 'Trend: nodirection for 1' });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 50,
        symbol: 'BTC/USDT',
      });
      expect(logs).toContainEqual({ level: 'debug', message: 'Trend: nodirection for 2' });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150,
        symbol: 'BTC/USDT',
      });
      expect(logs).toContainEqual({ level: 'debug', message: 'Trend: overbought for 1' });
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 50,
        symbol: 'BTC/USDT',
      });
      expect(logs).toContainEqual({ level: 'debug', message: 'Trend: nodirection for 0' });
    });

    describe('persistence = 0', () => {
      beforeEach(() => {
        tools.strategyParams.thresholds.persistence = 0;
      });

      it('should emit short advice immediately on overbought', () => {
        strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
          results: 150,
          symbol: 'BTC/USDT',
        });
        expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1, symbol: 'BTC/USDT' }]);
      });

      it('should emit long advice immediately on oversold', () => {
        strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
          results: -150,
          symbol: 'BTC/USDT',
        });
        expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol: 'BTC/USDT' }]);
      });
    });
  });

  describe('log', () => {
    it.each`
      cciRes       | expectedLogsLength
      ${undefined} | ${0}
      ${'invalid'} | ${0}
    `('should not log when CCI result is missing or invalid ($cciRes)', ({ cciRes, expectedLogsLength }) => {
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, { results: cciRes, symbol: 'BTC/USDT' });
      expect(logs).toHaveLength(expectedLogsLength);
    });

    it('should log CCI property', () => {
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: 150.1234,
        symbol: 'BTC/USDT',
      });
      expect(logs).toContainEqual({
        level: 'debug',
        message: 'CCI: 150.12',
      });
    });
  });
});
