import type { StrategyOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { OrderRecorder, playSteps } from '@strategies/positionTracker.mock';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SMACrossover } from './smaCrossover.strategy';
import { SMACrossoverStrategyParams } from './smaCrossover.types';

const symbol = 'BTC/USDT';
const makeIndicator = (res: any) => [{ results: res, symbol }] as any;
// The close of each step of the scenarios played below, against an SMA of 100. The first candle only records where the price is.
const PRICES = { above: 110, below: 90 } as const;

describe('SMACrossover Strategy', () => {
  let strategy: SMACrossover;
  let orders: OrderRecorder;
  let advices: StrategyOrder[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  const createCandle = (close: number) => ({ close, open: close, high: close, low: close }) as any;
  const setBucket = (price: number) => {
    bucket = new Map();
    bucket.set(symbol, createCandle(price));
  };

  /** Plays the steps (see playSteps): a price (above, below the SMA) is a candle */
  const play = (steps: string) =>
    playSteps(steps, strategy, orders, step => {
      setBucket(PRICES[step as keyof typeof PRICES]);
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>,
        ...makeIndicator(100),
      );
    });
  const sides = () => advices.map(({ side }) => side);

  beforeEach(() => {
    strategy = new SMACrossover();
    orders = new OrderRecorder();
    advices = orders.advices;
    logs = [];
    addIndicator = vi.fn();

    tools = {
      strategyParams: { period: 20, src: 'close' },
      createOrder: orders.createOrder,
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

    it('should emit a MARKET BUY when the price crosses above the SMA and flat', () => {
      play('below above');
      expect(advices).toEqual([{ type: 'MARKET', side: 'BUY', amount: 1, symbol }]);
    });

    it('should emit a MARKET SELL when the price crosses below the SMA and long', () => {
      play('below above completed:1 below');
      expect(advices[1]).toEqual({ type: 'MARKET', side: 'SELL', amount: 1, symbol });
    });

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
      case                                            | steps                                                | expectedSides
      ${'crossovers once each order filled'}          | ${'below above completed:1 below completed:2 above'} | ${['BUY', 'SELL', 'BUY']}
      ${'a cross below when flat'}                    | ${'above below above'}                               | ${['BUY']}
      ${'a cross below while the BUY pends'}          | ${'below above below above'}                         | ${['BUY']}
      ${'a cross below skipped, then the BUY filled'} | ${'below above below completed:1 below'}             | ${['BUY']}
      ${'a cross above while long'}                   | ${'below above completed:1 below errored:2 above'}   | ${['BUY', 'SELL']}
      ${'a cross above while the SELL pends'}         | ${'below above completed:1 below above'}             | ${['BUY', 'SELL']}
    `('should advise once per position change on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
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

  describe('order outcomes', () => {
    // An outcome reports nothing of an execution, unless its step gives the BTC left free after it ('errored:2:0', see playSteps)
    it.each`
      case                                                         | steps                                                     | expectedSides
      ${'a BUY completed: long, it sells on the next cross below'} | ${'below above completed:1 below'}                        | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys on the next cross above'}   | ${'below above canceled:1 below above'}                   | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys on the next cross above'}    | ${'below above errored:1 below above'}                    | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys on the next cross above'} | ${'below above completed:1 below completed:2 above'}      | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells on the next cross below'} | ${'below above completed:1 below canceled:2 above below'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells on the next cross below'}  | ${'below above completed:1 below errored:2 above below'}  | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored, all sold: flat, it buys again'}           | ${'below above completed:1 below errored:2:0 above'}      | ${['BUY', 'SELL', 'BUY']}
      ${'another order completed: still pending'}                  | ${'below above completed:unknown below above'}            | ${['BUY']}
      ${'another order canceled: still pending'}                   | ${'below above canceled:unknown below above'}             | ${['BUY']}
      ${'another order errored: still pending'}                    | ${'below above errored:unknown below above'}              | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
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

  describe('schema', () => {
    // The documentation's example, without the name that labels the run: the manager parses the block without it
    const params = { period: 20, src: 'close' };

    it.each`
      scenario                               | block             | expected
      ${'the documentation example'}         | ${params}         | ${params}
      ${'a block without src, on the close'} | ${{ period: 20 }} | ${params}
    `('accepts $scenario', ({ block, expected }) => {
      expect(SMACrossover.schema.parse(block)).toEqual(expected);
    });

    it('refuses a misspelt period (periode)', () => {
      expect(SMACrossover.schema.safeParse({ periode: 20, src: 'close' }).error?.issues).toMatchObject([
        { path: ['period'] },
        { code: 'unrecognized_keys', keys: ['periode'], path: [] },
      ]);
    });

    it.each`
      scenario                                            | block                            | path
      ${'a quoted period'}                                | ${{ ...params, period: '20' }}   | ${['period']}
      ${'a fractional period'}                            | ${{ ...params, period: 2.5 }}    | ${['period']}
      ${'a period of 0'}                                  | ${{ ...params, period: 0 }}      | ${['period']}
      ${'a NaN period'}                                   | ${{ ...params, period: NaN }}    | ${['period']}
      ${'an unknown source'}                              | ${{ ...params, src: 'hl3' }}     | ${['src']}
      ${'a misspelt src (source), not left to the close'} | ${{ period: 20, source: 'hl2' }} | ${[]}
    `('refuses $scenario', ({ block, path }) => {
      expect(SMACrossover.schema.safeParse(block).error?.issues).toMatchObject([{ path }]);
    });
  });
});
