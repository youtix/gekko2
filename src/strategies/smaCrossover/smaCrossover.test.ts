import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SMACrossover } from './smaCrossover.strategy';
import { SMACrossoverStrategyParams } from './smaCrossover.types';

const symbol = 'BTC/USDT';
const makeIndicator = (res: any) => [{ results: res, symbol }] as any;

describe('SMACrossover Strategy', () => {
  let strategy: SMACrossover;
  let advices: AdviceOrder[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  const createCandle = (close: number) => ({ close, open: close, high: close, low: close }) as any;
  const setBucket = (price: number) => {
    bucket = new Map();
    bucket.set(symbol, createCandle(price));
  };

  beforeEach(() => {
    strategy = new SMACrossover();
    advices = [];
    logs = [];
    addIndicator = vi.fn();

    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });

    tools = {
      strategyParams: { period: 20, src: 'close' },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn((level: LogLevel, message: string) => logs.push({ level, message })),
    };

    setBucket(100);
    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<SMACrossoverStrategyParams>);
  });

  describe('init', () => {
    it('should add SMA indicator with period and src from strategyParams', () => {
      const customTools = { ...tools, strategyParams: { period: 50, src: 'high' } };
      const customStrategy = new SMACrossover();
      customStrategy.init({ tools: customTools, addIndicator, candle: bucket } as unknown as InitParams<SMACrossoverStrategyParams>);
      expect(addIndicator).toHaveBeenCalledWith('SMA', symbol, { period: 50, src: 'high' });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new SMACrossover();
      emptyStrategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
        ...makeIndicator(100),
      );
      expect(advices).toHaveLength(0);
    });

    it('should do nothing if current candle is missing', () => {
      const emptyBucket = new Map();
      strategy.onTimeframeCandleAfterWarmup(
        { candle: emptyBucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
        ...makeIndicator(100),
      );
      expect(advices).toHaveLength(0);
    });

    it.each`
      smaRes
      ${undefined}
      ${null}
      ${'invalid'}
    `('should do nothing when SMA result is invalid ($smaRes)', ({ smaRes }) => {
      setBucket(100);
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
        ...makeIndicator(smaRes),
      );
      expect(advices).toHaveLength(0);
    });

    it('should record initial state without creating an order on first candle', () => {
      setBucket(100);
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
        ...makeIndicator(95),
      ); // price above SMA
      expect(advices).toHaveLength(0);
      expect(logs).toContainEqual(expect.objectContaining({ message: expect.stringContaining('Initial state') }));
    });

    it.each`
      candle1Price | candle2Price | sma    | expectedSide
      ${90}        | ${110}       | ${100} | ${'BUY'}
      ${110}       | ${90}        | ${100} | ${'SELL'}
    `(
      'should emit $expectedSide when crossing SMA=$sma (C1=$candle1Price, C2=$candle2Price)',
      ({ candle1Price, candle2Price, sma, expectedSide }) => {
        setBucket(candle1Price);
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
          ...makeIndicator(sma),
        );

        setBucket(candle2Price);
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
          ...makeIndicator(sma),
        );

        expect(advices).toEqual([{ type: 'MARKET', side: expectedSide, amount: 1, symbol }]);
      },
    );

    it.each`
      prices             | sma    | description
      ${[110, 115, 120]} | ${100} | ${'stays above'}
      ${[90, 85, 80]}    | ${100} | ${'stays below'}
      ${[100, 100, 100]} | ${100} | ${'equals'}
    `('should not create order when price $description SMA', ({ prices, sma }) => {
      for (const price of prices) {
        setBucket(price);
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
          ...makeIndicator(sma),
        );
      }
      expect(advices).toHaveLength(0);
    });

    it.each`
      prices                     | sma    | expectedSides
      ${[90, 110, 90, 110]}      | ${100} | ${['BUY', 'SELL', 'BUY']}
      ${[110, 90, 110, 90, 110]} | ${100} | ${['SELL', 'BUY', 'SELL', 'BUY']}
    `('should handle crossovers correctly: $expectedSides', ({ prices, sma, expectedSides }) => {
      for (const price of prices) {
        setBucket(price);
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
          ...makeIndicator(sma),
        );
      }

      expect(advices).toHaveLength(expectedSides.length);
      for (let i = 0; i < expectedSides.length; i++) {
        expect(advices[i]).toEqual({ type: 'MARKET', side: expectedSides[i], amount: 1, symbol });
      }
    });

    it('should always use MARKET order type', () => {
      setBucket(90);
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
        ...makeIndicator(100),
      );

      setBucket(110);
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
        ...makeIndicator(100),
      );

      expect(advices[0].type).toBe('MARKET');
    });
  });

  describe('log', () => {
    it('should not log if pair is not defined', () => {
      const emptyStrategy = new SMACrossover();
      emptyStrategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>, ...makeIndicator(99.5));
      expect(logs).toHaveLength(0);
    });

    it('should not log if candle is missing', () => {
      strategy.log({ candle: new Map(), tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>, ...makeIndicator(99.5));
      expect(logs).toHaveLength(0);
    });

    it.each`
      smaRes
      ${undefined}
      ${null}
      ${'invalid'}
    `('should not log when SMA is missing or invalid ($smaRes)', ({ smaRes }) => {
      setBucket(100.12345);
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>, ...makeIndicator(smaRes));
      expect(logs).toHaveLength(0);
    });

    it('should log SMA and price values', () => {
      setBucket(100.12345);
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>, ...makeIndicator(99.54321));
      expect(logs).toContainEqual(expect.objectContaining({ message: expect.stringContaining('SMA: 99.54321 | Price: 100.12345') }));
    });
  });
});
