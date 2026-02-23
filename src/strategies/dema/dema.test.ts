import { AdviceOrder } from '@models/advice.types';
import { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMA } from './dema.strategy';
import { DEMAStrategyParams } from './dema.types';

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
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  beforeEach(() => {
    strategy = new DEMA();
    advices = [];
    logs = [];
    addIndicator = vi.fn();

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });

    tools = {
      strategyParams: { period: 14, thresholds: { up: 0.5, down: -0.5 } },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn((level: LogLevel, message: string) => logs.push({ level, message })),
    };

    bucket = new Map();
    bucket.set('BTC/USDT', { close: 10 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<DEMAStrategyParams>);
  });

  describe('init', () => {
    it('should add DEMA indicator with strategy period', () => {
      expect(addIndicator).toHaveBeenCalledWith('DEMA', 'BTC/USDT', { period: 14 });
    });

    it('should add SMA indicator with strategy period', () => {
      expect(addIndicator).toHaveBeenCalledWith('SMA', 'BTC/USDT', { period: 14 });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new DEMA();
      emptyStrategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1, symbol: 'BTC/USDT' },
        { results: 2, symbol: 'BTC/USDT' },
      );
      expect(advices).toHaveLength(0);
    });

    it('should do nothing if candle for the pair is not found', () => {
      const emptyBucket = new Map();
      strategy.onTimeframeCandleAfterWarmup(
        { candle: emptyBucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1, symbol: 'BTC/USDT' },
        { results: 2, symbol: 'BTC/USDT' },
      );
      expect(advices).toHaveLength(0);
    });

    it.each`
      smaRes       | demaRes      | expectedAdvices
      ${undefined} | ${undefined} | ${0}
      ${1}         | ${undefined} | ${0}
      ${undefined} | ${2}         | ${0}
      ${'invalid'} | ${2}         | ${0}
    `('should do nothing when results are invalid (sma: $smaRes, dema: $demaRes)', ({ smaRes, demaRes, expectedAdvices }) => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: demaRes, symbol: 'BTC/USDT' },
        { results: smaRes, symbol: 'BTC/USDT' },
      );
      expect(advices).toHaveLength(expectedAdvices);
    });

    it.each`
      smaRes | demaRes | diff  | expectedSide | expectedTrend
      ${2}   | ${1}    | ${1}  | ${'BUY'}     | ${'uptrend'}
      ${0}   | ${1}    | ${-1} | ${'SELL'}    | ${'downtrend'}
    `('should emit $expectedSide advice when diff is $diff ($expectedTrend)', ({ smaRes, demaRes, expectedSide }) => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: demaRes, symbol: 'BTC/USDT' },
        { results: smaRes, symbol: 'BTC/USDT' },
      );
      expect(advices).toEqual([{ type: 'STICKY', side: expectedSide, amount: 1, symbol: 'BTC/USDT' }]);
    });

    it('should not re-advise on continued trend', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1, symbol: 'BTC/USDT' },
        { results: 2, symbol: 'BTC/USDT' },
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1, symbol: 'BTC/USDT' },
        { results: 2, symbol: 'BTC/USDT' },
      );
      expect(advices).toHaveLength(1);
    });

    it('should log when not in an up or down trend', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1, symbol: 'BTC/USDT' },
        { results: 1, symbol: 'BTC/USDT' },
      ); // Diff = 0
      expect(logs).toContainEqual({
        level: 'debug',
        message: 'We are currently not in an up or down trend: @ 10.00000000 (1.00000/0.00000)',
      });
    });
  });

  describe('log', () => {
    it.each`
      smaRes       | demaRes      | expectedLogsLength
      ${undefined} | ${undefined} | ${0}
      ${1}         | ${undefined} | ${0}
      ${undefined} | ${2}         | ${0}
    `('should not log when results are missing (sma: $smaRes, dema: $demaRes)', ({ smaRes, demaRes, expectedLogsLength }) => {
      strategy.log(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: demaRes, symbol: 'BTC/USDT' },
        { results: smaRes, symbol: 'BTC/USDT' },
      );
      expect(logs).toHaveLength(expectedLogsLength);
    });

    it('should log DEMA and SMA properties', () => {
      strategy.log(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: 1.23456, symbol: 'BTC/USDT' },
        { results: 2.34567, symbol: 'BTC/USDT' },
      );
      expect(logs).toContainEqual({
        level: 'debug',
        message: 'Calculated DEMA and SMA properties for candle: DEMA: 1.23456 SMA: 2.34567',
      });
    });
  });
});
