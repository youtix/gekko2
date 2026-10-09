import type { StrategyOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { ETH_IGNORED_WARNING, logsAtInit, OrderRecorder, playSteps } from '@strategies/positionTracker.mock';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SMACrossover } from './smaCrossover.strategy';
import { SMACrossoverStrategyParams } from './smaCrossover.types';

const symbol = 'BTC/USDT';
const makeIndicator = (res: any) => [{ results: res, symbol }] as any;
const ULP = 2 ** -46; // the gap between 100 and the next double
// The close and the SMA of each step of the scenarios played below. The first candle only records where the price is. A flat window
// (one close for the whole period) leaves the running-sum SMA a few ulps off that close, on either side: 'on+' has it one ulp above
// the close, 'on-' one ulp below, 'on' on it. 'tick+' and 'tick-' have the close a tick above or below the SMA, 'nan' the SMA NaN,
// 'null' the SMA not ready yet, what the indicator gives until its period is full.
const STEPS = {
  above: { close: 110, sma: 100 },
  below: { close: 90, sma: 100 },
  on: { close: 100, sma: 100 },
  'on+': { close: 100, sma: 100 + ULP },
  'on-': { close: 100, sma: 100 - ULP },
  'tick+': { close: 100.01, sma: 100 },
  'tick-': { close: 99.99, sma: 100 },
  nan: { close: 100, sma: NaN },
  null: { close: 100, sma: null },
} as const;
// All-in, as the strategy creates them: without amount, the Trader sizes them from all the free currency (BUY) or asset (SELL)
const allInBuy = { type: 'MARKET', side: 'BUY', symbol } satisfies StrategyOrder;
const allInSell = { type: 'MARKET', side: 'SELL', symbol } satisfies StrategyOrder;

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

  /**
   * Plays a timeframe candle, the bucket set before, as the StrategyManager does: onEachTimeframeCandle on every candle, the warmup
   * included, then, once the warmup is over, onTimeframeCandleAfterWarmup with the same SMA
   */
  const playCandle = (sma: unknown, afterWarmup = true) => {
    const params = { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>;
    strategy.onEachTimeframeCandle(params, ...makeIndicator(sma));
    if (afterWarmup) strategy.onTimeframeCandleAfterWarmup(params, ...makeIndicator(sma));
  };

  /**
   * Plays the steps (see playSteps): a close and an SMA (see STEPS) are a candle after the warmup, their name in parentheses a warmup
   * candle
   */
  const play = (steps: string) =>
    playSteps(steps, strategy, orders, step => {
      const isWarmup = step.startsWith('(') && step.endsWith(')');
      const name = isWarmup ? step.slice(1, -1) : step;
      if (!(name in STEPS)) throw new Error(`No step named ${name}, in "${steps}"`);
      const { close, sma } = STEPS[name as keyof typeof STEPS];
      setBucket(close);
      playCandle(sma, !isWarmup);
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

    // The bucket holds a candle of every watched pair, in the order of watch.assets: the strategy trades the first one only
    it.each`
      case           | pairs                       | expected
      ${'one pair'}  | ${['BTC/USDT']}             | ${[]}
      ${'two pairs'} | ${['BTC/USDT', 'ETH/USDT']} | ${[ETH_IGNORED_WARNING]}
    `('should warn once, at init, when it ignores watched pairs: $case', ({ pairs, expected }) => {
      expect(logsAtInit(new SMACrossover(), pairs, tools.strategyParams)).toEqual(expected);
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new SMACrossover();
      // Below the SMA, then above it: a crossover, had init picked the pair
      for (const close of [90, 110]) {
        setBucket(close);
        const params = { candle: bucket, tools } as unknown as OnCandleEventParams<SMACrossoverStrategyParams>;
        emptyStrategy.onEachTimeframeCandle(params, ...makeIndicator(100));
        emptyStrategy.onTimeframeCandleAfterWarmup(params, ...makeIndicator(100));
      }
      expect({ advices, logs }).toEqual({ advices: [], logs: [] });
    });

    it('should do nothing if current candle is missing', () => {
      bucket = new Map();
      playCandle(100);
      expect({ advices, logs }).toEqual({ advices: [], logs: [] });
    });

    // Nothing logged either: a NaN SMA, compared with the price, was recorded as the price being below it
    it.each`
      smaRes
      ${undefined}
      ${null}
      ${'invalid'}
      ${NaN}
      ${Infinity}
      ${-Infinity}
    `('should do nothing when SMA result is invalid ($smaRes)', ({ smaRes }) => {
      setBucket(100);
      playCandle(smaRes);
      expect({ advices, logs }).toEqual({ advices: [], logs: [] });
    });

    // Compared as 0, a null SMA would put the price above it: that side recorded, the crossover of the next candle would be missed
    it.each`
      case                                       | steps                                  | expectedSides
      ${'NaN before the first state'}            | ${'nan above'}                         | ${[]}
      ${'NaN between the two sides of a cross'}  | ${'below nan above'}                   | ${['BUY']}
      ${'NaN above the SMA, when long'}          | ${'below above completed:1 nan tick+'} | ${['BUY']}
      ${'null between the two sides of a cross'} | ${'below null above'}                  | ${['BUY']}
    `('should skip a candle whose SMA is NaN or null, as one not ready yet: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it('should record initial state without creating an order on first candle', () => {
      setBucket(100);
      playCandle(95); // price above SMA
      expect({ advices, logs }).toEqual({ advices: [], logs: [{ level: 'info', message: 'Initial state: price above SMA' }] });
    });

    it.each`
      case                                   | steps                              | expected
      ${'a BUY on a cross above when flat'}  | ${'below above'}                   | ${[allInBuy]}
      ${'a SELL on a cross below when long'} | ${'below above completed:1 below'} | ${[allInBuy, allInSell]}
    `('should emit an all-in MARKET order: $case', ({ steps, expected }) => {
      play(steps);
      expect(advices).toStrictEqual(expected);
    });

    it.each`
      prices             | sma    | description
      ${[110, 115, 120]} | ${100} | ${'stays above'}
      ${[90, 85, 80]}    | ${100} | ${'stays below'}
      ${[100, 100, 100]} | ${100} | ${'equals'}
    `('should not create order when price $description SMA', ({ prices, sma }) => {
      for (const price of prices) {
        setBucket(price);
        playCandle(sma);
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
      ${'a cross below while the SELL pends'}         | ${'below above completed:1 below above below'}       | ${['BUY', 'SELL']}
    `('should advise once per position change on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it('should always use MARKET order type', () => {
      setBucket(90);
      playCandle(100);

      setBucket(110);
      playCandle(100);

      expect(advices[0].type).toBe('MARKET');
    });

    // src only selects what the SMA averages: the price that crosses it is the close, whatever the open, high and low of the candle
    it('should compare the close with the SMA, whatever source the SMA averages', () => {
      strategy = new SMACrossover();
      const hl2Tools = { ...tools, strategyParams: { period: 20, src: 'hl2' } };
      strategy.init({ candle: bucket, tools: hl2Tools, addIndicator } as unknown as InitParams<SMACrossoverStrategyParams>);
      // The close crosses the SMA upwards, while every other price of the candles, hl2, hlc3 and ohlc4 included, crosses it downwards or
      // stays on one side of it
      for (const candle of [
        { open: 120, high: 130, low: 88, close: 90 },
        { open: 85, high: 112, low: 60, close: 110 },
      ]) {
        bucket = new Map([[symbol, { start: 0, volume: 1, ...candle }]]);
        playCandle(100);
      }
      expect(sides()).toEqual(['BUY']);
    });
  });

  describe('the side of the price during the warmup', () => {
    // A step in parentheses is a warmup candle: the strategy records the side of the price on it, and trades nothing
    it.each`
      case                                      | steps                      | expectedSides
      ${'below at the warmup end, then above'}  | ${'(below) above'}         | ${['BUY']}
      ${'below, on the SMA at the end, above'}  | ${'(below) (on) above'}    | ${['BUY']}
      ${'above at the warmup end, then above'}  | ${'(above) above'}         | ${[]}
      ${'a cross within the warmup only'}       | ${'(below) (above) above'} | ${[]}
      ${'a cross below at the end, when flat'}  | ${'(above) below'}         | ${[]}
      ${'no SMA in the warmup, then a cross'}   | ${'(nan) below above'}     | ${['BUY']}
      ${'no SMA in the warmup, the first side'} | ${'(nan) above'}           | ${[]}
    `('should trade a crossover from the last warmup candle on: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it('should log the initial state from the warmup, then the crossover after it', () => {
      play('(below) above');
      expect(logs.filter(({ level }) => level === 'info')).toEqual([
        { level: 'info', message: 'Initial state: price below SMA' },
        { level: 'info', message: 'SMA crossed DOWN price (100.00000 < 110.00000) => BUY' },
      ]);
    });
  });

  describe('on a flat window', () => {
    // Compared strictly, an SMA one ulp above the price, or on it, read as the price below it, one ulp below as the price above it.
    // Long or flat is the position held when the window turns flat.
    it.each`
      case                                       | steps                                       | expectedSides
      ${'SMA an ulp above the price, when long'} | ${'below above completed:1 on+'}            | ${['BUY']}
      ${'SMA on the price, when long'}           | ${'below above completed:1 on'}             | ${['BUY']}
      ${'SMA an ulp below the price, when long'} | ${'below above completed:1 on-'}            | ${['BUY']}
      ${'SMA wobbling around it, when long'}     | ${'below above completed:1 on- on+ on on+'} | ${['BUY']}
      ${'SMA an ulp below the price, when flat'} | ${'below on-'}                              | ${[]}
      ${'SMA on the price, when flat'}           | ${'below on'}                               | ${[]}
      ${'SMA an ulp above the price, when flat'} | ${'below on+'}                              | ${[]}
      ${'SMA wobbling around it, when flat'}     | ${'below on+ on- on on-'}                   | ${[]}
    `('should not cross on a flat window: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it.each`
      case                                 | steps                                      | expectedSides
      ${'a tick below the SMA, when long'} | ${'below above completed:1 on+ on- tick-'} | ${['BUY', 'SELL']}
      ${'a tick above the SMA, when long'} | ${'below above completed:1 on+ on- tick+'} | ${['BUY']}
      ${'a tick above the SMA, when flat'} | ${'below on- on+ tick+'}                   | ${['BUY']}
      ${'a tick below the SMA, when flat'} | ${'below on- on+ tick-'}                   | ${[]}
    `('should cross once the price leaves the SMA on the other side: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it.each`
      case                                    | steps               | expectedSides
      ${'on the SMA, then above it'}          | ${'on above'}       | ${[]}
      ${'ulps off the SMA, then above it'}    | ${'on+ on- above'}  | ${[]}
      ${'on the SMA, then below, then above'} | ${'on below above'} | ${['BUY']}
    `('should take the first side after the warmup as the initial state: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it('should log the initial state once the price leaves the SMA', () => {
      play('on on+ above');
      expect(logs.filter(({ level }) => level === 'info')).toEqual([{ level: 'info', message: 'Initial state: price above SMA' }]);
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
      ${NaN}
      ${Infinity}
      ${-Infinity}
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
