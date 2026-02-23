import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MACD } from './macd.strategy';
import { MACDStrategyParams } from './macd.types';

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

const symbol = 'BTC/USDT';
const makeIndicator = (res: any) => [{ results: res, symbol }] as any;

describe('MACD Strategy', () => {
  let strategy: MACD;
  let advices: AdviceOrder[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  beforeEach(() => {
    strategy = new MACD();
    advices = [];
    logs = [];
    addIndicator = vi.fn();

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });

    tools = {
      strategyParams: {
        short: 12,
        long: 26,
        signal: 9,
        macdSrc: 'macd',
        thresholds: { up: 0.5, down: -0.5, persistence: 2 },
      },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn((level: LogLevel, message: string) => logs.push({ level, message })),
    };

    bucket = new Map();
    bucket.set(symbol, { close: 1 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<MACDStrategyParams>);
  });

  describe('init', () => {
    it('should add MACD indicator with strategy parameters', () => {
      expect(addIndicator).toHaveBeenCalledWith('MACD', symbol, { short: 12, long: 26, signal: 9 });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new MACD();
      emptyStrategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      expect(advices).toHaveLength(0);
    });

    it.each`
      macdRes
      ${null}
      ${undefined}
      ${'invalid'}
      ${{ macd: 'not_number', signal: 0, hist: 0 }}
      ${{ macd: 1, signal: 'not_number', hist: 0 }}
      ${{ macd: 1, signal: 0, hist: 'not_number' }}
    `('should do nothing when MACD result is invalid ($macdRes)', ({ macdRes }) => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator(macdRes),
      );
      expect(advices).toHaveLength(0);
    });

    it('should not emit advice before persistence on uptrend', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      expect(advices).toHaveLength(0);
    });

    it('should emit long advice after persistence on uptrend', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol }]);
    });

    it('should not emit multiple long advices while uptrend continues', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      expect(advices).toHaveLength(1);
    });

    it('should emit short advice after persistence on downtrend', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: -1, signal: 0, hist: 0 }),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: -1, signal: 0, hist: 0 }),
      );
      expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', amount: 1, symbol }]);
    });

    it('should not emit multiple short advices while downtrend continues', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: -1, signal: 0, hist: 0 }),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: -1, signal: 0, hist: 0 }),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: -1, signal: 0, hist: 0 }),
      );
      expect(advices).toHaveLength(1);
    });

    it('should reset trend when switching from up to down', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1, signal: 0, hist: 0 }),
      );

      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: -1, signal: 0, hist: 0 }),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: -1, signal: 0, hist: 0 }),
      );

      expect(advices).toEqual([
        { type: 'STICKY', side: 'BUY', amount: 1, symbol },
        { type: 'STICKY', side: 'SELL', amount: 1, symbol },
      ]);
    });

    it('should log when no trend detected', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 0, signal: 0, hist: 0 }),
      );
      expect(logs).toContainEqual({ level: 'debug', message: 'MACD: no trend detected' });
      expect(advices).toHaveLength(0);
    });
  });

  describe('log', () => {
    it.each`
      macdRes
      ${null}
      ${undefined}
      ${'invalid'}
    `('should not log when MACD result is missing or invalid ($macdRes)', ({ macdRes }) => {
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>, ...makeIndicator(macdRes));
      expect(logs).toHaveLength(0);
    });

    it('should log MACD properties', () => {
      strategy.log(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1.12345678, signal: 2.12345678, hist: 3.12345678 }),
      );
      expect(logs).toContainEqual({ level: 'debug', message: 'macd: 1.12345678' });
      expect(logs).toContainEqual({ level: 'debug', message: 'signal: 2.12345678' });
      expect(logs).toContainEqual({ level: 'debug', message: 'hist: 3.12345678' });
    });
  });
});
