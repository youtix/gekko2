import type { StrategyOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { ETH_IGNORED_WARNING, logsAtInit, OrderRecorder, playSteps } from '@strategies/positionTracker.mock';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { omit } from 'lodash-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MACD } from './macd.strategy';
import { MACDStrategyParams } from './macd.types';

const symbol = 'BTC/USDT';
const makeIndicator = (res: any) => [{ results: res, symbol }] as any;
// The MACD result of each step of the scenarios played below (hist = macd - signal), with one field only beyond the thresholds
// 0.5 / -0.5: only the field macdSrc names can make a trend. up and down move the MACD line, which the suite trades (macdSrc: 'macd'),
// signalUp and signalDown the signal line, histUp and histDown the histogram. Null is what the indicator gives until it is ready.
const MACD_RESULTS = {
  up: { macd: 0.8, signal: 0.4, hist: 0.4 },
  down: { macd: -0.8, signal: -0.4, hist: -0.4 },
  none: { macd: 0, signal: 0, hist: 0 },
  signalUp: { macd: 0.4, signal: 0.8, hist: -0.4 },
  signalDown: { macd: -0.4, signal: -0.8, hist: 0.4 },
  histUp: { macd: 0.4, signal: -0.4, hist: 0.8 },
  histDown: { macd: -0.4, signal: 0.4, hist: -0.8 },
  null: null,
} as const;
// All-in, as the strategy creates them: without amount, the Trader sizes them from all the free currency (BUY) or asset (SELL)
const allInBuy = { type: 'STICKY', side: 'BUY', symbol } satisfies StrategyOrder;
const allInSell = { type: 'STICKY', side: 'SELL', symbol } satisfies StrategyOrder;

describe('MACD Strategy', () => {
  let strategy: MACD;
  let orders: OrderRecorder;
  let advices: StrategyOrder[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  /** Plays the steps (see playSteps): a MACD result (see MACD_RESULTS) is a candle */
  const play = (steps: string) =>
    playSteps(steps, strategy, orders, step => {
      // A misspelt step would be an undefined result, a candle skipped
      if (!(step in MACD_RESULTS)) throw new Error(`No step named ${step}, in "${steps}"`);
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator(MACD_RESULTS[step as keyof typeof MACD_RESULTS]),
      );
    });
  const sides = () => advices.map(({ side }) => side);

  beforeEach(() => {
    strategy = new MACD();
    orders = new OrderRecorder();
    advices = orders.advices;
    logs = [];
    addIndicator = vi.fn();

    tools = {
      strategyParams: {
        short: 12,
        long: 26,
        signal: 9,
        macdSrc: 'macd',
        thresholds: { up: 0.5, down: -0.5, persistence: 2 },
      },
      createOrder: orders.createOrder,
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

    // The bucket holds a candle of every watched pair, in the order of watch.assets: the strategy trades the first one only
    it.each`
      case           | pairs                       | expected
      ${'one pair'}  | ${['BTC/USDT']}             | ${[]}
      ${'two pairs'} | ${['BTC/USDT', 'ETH/USDT']} | ${[ETH_IGNORED_WARNING]}
    `('should warn once, at init, when it ignores watched pairs: $case', ({ pairs, expected }) => {
      expect(logsAtInit(new MACD(), pairs, tools.strategyParams)).toEqual(expected);
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    // An uptrend over the persistence, which buys once init has picked the pair: before it, the order would have no symbol
    it('should do nothing before init has picked the pair', () => {
      strategy = new MACD();
      play('up up');
      expect({ advices, logs }).toEqual({ advices: [], logs: [] });
    });

    // Nothing logged either: a NaN MACD failed both thresholds, logged as no trend, and an infinite one started a trend
    it.each`
      macdRes
      ${null}
      ${undefined}
      ${'invalid'}
      ${{ macd: 'not_number', signal: 0, hist: 0 }}
      ${{ macd: 1, signal: 'not_number', hist: 0 }}
      ${{ macd: 1, signal: 0, hist: 'not_number' }}
      ${{ macd: NaN, signal: 0, hist: 0 }}
      ${{ macd: Infinity, signal: 1, hist: 1 }}
      ${{ macd: 1, signal: NaN, hist: 0 }}
      ${{ macd: 1, signal: 1, hist: -Infinity }}
    `('should do nothing when MACD result is invalid ($macdRes)', ({ macdRes }) => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator(macdRes),
      );
      expect({ advices, logs }).toEqual({ advices: [], logs: [] });
    });

    // Unskipped, a null MACD would throw as its field is read
    it.each`
      case                         | steps                                 | expectedSides
      ${'null within an uptrend'}  | ${'up null up'}                       | ${['BUY']}
      ${'null within a downtrend'} | ${'up up completed:1 down null down'} | ${['BUY', 'SELL']}
    `('should skip a candle whose MACD is null, as one not ready yet: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it.each`
      case                                 | steps                            | expected
      ${'a BUY on an uptrend when flat'}   | ${'up up'}                       | ${[allInBuy]}
      ${'a SELL on a downtrend when long'} | ${'up up completed:1 down down'} | ${[allInBuy, allInSell]}
    `('should emit an all-in STICKY order after persistence: $case', ({ steps, expected }) => {
      play(steps);
      expect(advices).toStrictEqual(expected);
    });

    it.each`
      case                                      | steps                                                     | expectedSides
      ${'an uptrend before persistence'}        | ${'up'}                                                   | ${[]}
      ${'an uptrend that continues'}            | ${'up up up'}                                             | ${['BUY']}
      ${'a downtrend before persistence'}       | ${'up up completed:1 down'}                               | ${['BUY']}
      ${'a downtrend that continues'}           | ${'up up completed:1 down down down'}                     | ${['BUY', 'SELL']}
      ${'a switch from up to down and back'}    | ${'up up completed:1 down down completed:2 up up'}        | ${['BUY', 'SELL', 'BUY']}
      ${'an uptrend after a shorter downtrend'} | ${'up up down up up'}                                     | ${['BUY']}
      ${'an uptrend while long'}                | ${'up up completed:1 down up up'}                         | ${['BUY']}
      ${'a downtrend after a shorter uptrend'}  | ${'up up completed:1 down down completed:2 up down down'} | ${['BUY', 'SELL']}
      ${'a downtrend when flat'}                | ${'down down down'}                                       | ${[]}
      ${'a downtrend while the BUY pends'}      | ${'up up down down'}                                      | ${['BUY']}
      ${'a new downtrend while the SELL pends'} | ${'up up completed:1 down down up down down'}             | ${['BUY', 'SELL']}
      ${'an uptrend once the SELL filled'}      | ${'up up completed:1 down down up up completed:2 up'}     | ${['BUY', 'SELL', 'BUY']}
    `('should advise once per position change on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it('should log when no trend detected, and advise nothing', () => {
      play('none');
      expect({ advices, logs }).toEqual({ advices: [], logs: [{ level: 'debug', message: 'MACD: no trend detected' }] });
    });
  });

  describe('macdSrc', () => {
    // Each step has one field of the result beyond a threshold: the field macdSrc names makes the trend, and the others do not
    it.each`
      macdSrc     | case                            | steps                                                          | expectedSides
      ${'macd'}   | ${'the others up, when flat'}   | ${'signalUp signalUp histUp histUp'}                           | ${[]}
      ${'macd'}   | ${'the others down, when long'} | ${'up up completed:1 signalDown signalDown histDown histDown'} | ${['BUY']}
      ${'signal'} | ${'its field up, when flat'}    | ${'signalUp signalUp'}                                         | ${['BUY']}
      ${'signal'} | ${'the others up, when flat'}   | ${'up up histUp histUp'}                                       | ${[]}
      ${'signal'} | ${'its field down, when long'}  | ${'signalUp signalUp completed:1 signalDown signalDown'}       | ${['BUY', 'SELL']}
      ${'signal'} | ${'the others down, when long'} | ${'signalUp signalUp completed:1 down down histDown histDown'} | ${['BUY']}
      ${'hist'}   | ${'its field up, when flat'}    | ${'histUp histUp'}                                             | ${['BUY']}
      ${'hist'}   | ${'the others up, when flat'}   | ${'up up signalUp signalUp'}                                   | ${[]}
      ${'hist'}   | ${'its field down, when long'}  | ${'histUp histUp completed:1 histDown histDown'}               | ${['BUY', 'SELL']}
      ${'hist'}   | ${'the others down, when long'} | ${'histUp histUp completed:1 down down signalDown signalDown'} | ${['BUY']}
    `('should trade on the $macdSrc field only: $case', ({ macdSrc, steps, expectedSides }) => {
      tools.strategyParams.macdSrc = macdSrc;
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });
  });

  describe('order outcomes', () => {
    // An outcome reports nothing of an execution, unless its step gives the BTC left free after it ('errored:2:0', see playSteps)
    it.each`
      case                                                   | steps                                                         | expectedSides
      ${'a BUY completed: long, it sells'}                   | ${'up up completed:1 down down'}                              | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys on the next trend'}   | ${'up up canceled:1 up down up up'}                           | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys on the next trend'}    | ${'up up errored:1 up down up up'}                            | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys again'}             | ${'up up completed:1 down down completed:2 up up'}            | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells on the next trend'} | ${'up up completed:1 down down canceled:2 down up down down'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells on the next trend'}  | ${'up up completed:1 down down errored:2 down up down down'}  | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored, all sold: flat, it buys again'}     | ${'up up completed:1 down down errored:2:0 up up'}            | ${['BUY', 'SELL', 'BUY']}
      ${'another order completed: still pending'}            | ${'up up completed:unknown up down down'}                     | ${['BUY']}
      ${'another order canceled: still pending'}             | ${'up up canceled:unknown up down down'}                      | ${['BUY']}
      ${'another order errored: still pending'}              | ${'up up errored:unknown up down down'}                       | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });
  });

  describe('log', () => {
    it.each`
      macdRes
      ${null}
      ${undefined}
      ${'invalid'}
      ${{ macd: NaN, signal: 0, hist: 0 }}
      ${{ macd: 1, signal: 0, hist: Infinity }}
    `('should not log when MACD result is missing or invalid ($macdRes)', ({ macdRes }) => {
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>, ...makeIndicator(macdRes));
      expect(logs).toHaveLength(0);
    });

    it('should log MACD properties', () => {
      strategy.log(
        { candle: bucket, tools } as unknown as OnCandleEventParams<MACDStrategyParams>,
        ...makeIndicator({ macd: 1.12345678, signal: 2.12345678, hist: 3.12345678 }),
      );
      expect(logs).toEqual([
        { level: 'debug', message: 'macd: 1.12345678' },
        { level: 'debug', message: 'signal: 2.12345678' },
        { level: 'debug', message: 'hist: 3.12345678' },
      ]);
    });
  });

  describe('schema', () => {
    // The documentation's example, without the name that labels the run: the manager parses the block without it
    const params = { short: 12, long: 26, signal: 9, macdSrc: 'hist', thresholds: { up: 0, down: 0, persistence: 1 } };
    const withThresholds = (thresholds: object) => ({ ...params, thresholds: { ...params.thresholds, ...thresholds } });
    const swappedPeriods = 'short must be below long (swapped periods give the opposite MACD, equal ones a MACD of 0)';
    const signalOfOneOnHist =
      'signal must be at least 2 with macdSrc: hist (a signal of 1 makes the signal line the MACD line itself, and the histogram 0)';

    it('accepts the documentation example as it is', () => {
      expect(MACD.schema.parse(params)).toEqual(params);
    });

    // A signal of 1 is refused with the histogram only: the MACD line, which the signal line then equals, still moves
    it.each`
      scenario                                | block
      ${'a signal of 1 with macdSrc: macd'}   | ${{ ...params, signal: 1, macdSrc: 'macd' }}
      ${'a signal of 1 with macdSrc: signal'} | ${{ ...params, signal: 1, macdSrc: 'signal' }}
      ${'a signal of 2 with macdSrc: hist'}   | ${{ ...params, signal: 2 }}
    `('accepts $scenario', ({ block }) => {
      expect(MACD.schema.parse(block)).toEqual(block);
    });

    it('refuses a misspelt persistence (persistance)', () => {
      expect(MACD.schema.safeParse({ ...params, thresholds: { up: 0, down: 0, persistance: 1 } }).error?.issues).toMatchObject([
        { path: ['thresholds', 'persistence'] },
        { code: 'unrecognized_keys', keys: ['persistance'], path: ['thresholds'] },
      ]);
    });

    // A period of 0 is refused once, by its bound alone: neither the comparison of the periods nor the check of the signal reports it
    it.each`
      scenario                                  | block                                   | path
      ${'an unknown macdSrc (histogram)'}       | ${{ ...params, macdSrc: 'histogram' }}  | ${['macdSrc']}
      ${'a missing macdSrc'}                    | ${omit(params, 'macdSrc')}              | ${['macdSrc']}
      ${'a quoted signal'}                      | ${{ ...params, signal: '9' }}           | ${['signal']}
      ${'a fractional long'}                    | ${{ ...params, long: 26.5 }}            | ${['long']}
      ${'a short of 0'}                         | ${{ ...params, short: 0 }}              | ${['short']}
      ${'a long of 0'}                          | ${{ ...params, long: 0 }}               | ${['long']}
      ${'a signal of 0'}                        | ${{ ...params, signal: 0 }}             | ${['signal']}
      ${'swapped periods (short 26, long 12)'}  | ${{ ...params, short: 26, long: 12 }}   | ${[]}
      ${'equal periods'}                        | ${{ ...params, short: 26, long: 26 }}   | ${[]}
      ${'a signal of 1 with macdSrc: hist'}     | ${{ ...params, signal: 1 }}             | ${[]}
      ${'an infinite threshold'}                | ${withThresholds({ up: Infinity })}     | ${['thresholds', 'up']}
      ${'a fractional persistence'}             | ${withThresholds({ persistence: 0.5 })} | ${['thresholds', 'persistence']}
      ${'a src (the MACD strategy takes none)'} | ${{ ...params, src: 'close' }}          | ${[]}
    `('refuses $scenario', ({ block, path }) => {
      expect(MACD.schema.safeParse(block).error?.issues).toMatchObject([{ path }]);
    });

    it.each`
      scenario                              | block                                 | message
      ${'swapped periods'}                  | ${{ ...params, short: 26, long: 12 }} | ${swappedPeriods}
      ${'a signal of 1 with macdSrc: hist'} | ${{ ...params, signal: 1 }}           | ${signalOfOneOnHist}
    `('says why it refuses $scenario', ({ block, message }) => {
      expect(MACD.schema.safeParse(block).error?.issues[0].message).toBe(message);
    });

    // Each check reports on its own, so that a block with both mistakes is refused with both at once
    it('reports a signal of 1 with macdSrc: hist besides swapped periods', () => {
      const block = { ...params, short: 26, long: 12, signal: 1 };
      expect(MACD.schema.safeParse(block).error?.issues.map(({ message }) => message)).toEqual([swappedPeriods, signalOfOneOnHist]);
    });
  });
});
