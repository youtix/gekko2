import { StrategyOrder } from '@models/advice.types';
import { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { ETH_IGNORED_WARNING, logsAtInit, OrderRecorder, playSteps } from '@strategies/positionTracker.mock';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { omit } from 'lodash-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMA } from './dema.strategy';
import { DEMAStrategyParams } from './dema.types';

// The DEMA and SMA results of each step of the scenarios played below: diff = SMA - DEMA against the thresholds 0.5 / -0.5. Null is
// what an indicator gives until it is ready: the DEMA, ready later than the SMA of its period, or the SMA.
const TRENDS = {
  up: { dema: 1, sma: 2 },
  down: { dema: 1, sma: 0 },
  neutral: { dema: 1, sma: 1 },
  demaNull: { dema: null, sma: 2 },
  smaNull: { dema: 2, sma: null },
} as const;
// All-in, as the strategy creates them: without amount, the Trader sizes them from all the free currency (BUY) or asset (SELL)
const allInBuy = { type: 'STICKY', side: 'BUY', symbol: 'BTC/USDT' } satisfies StrategyOrder;
const allInSell = { type: 'STICKY', side: 'SELL', symbol: 'BTC/USDT' } satisfies StrategyOrder;

describe('DEMA Strategy', () => {
  let strategy: DEMA;
  let orders: OrderRecorder;
  let advices: StrategyOrder[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  /** Plays the steps (see playSteps): the DEMA and SMA results of a trend (see TRENDS) are a candle */
  const play = (steps: string) =>
    playSteps(steps, strategy, orders, step => {
      if (!(step in TRENDS)) throw new Error(`No step named ${step}, in "${steps}"`);
      const { dema, sma } = TRENDS[step as keyof typeof TRENDS];
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: dema, symbol: 'BTC/USDT' },
        { results: sma, symbol: 'BTC/USDT' },
      );
    });
  const sides = () => advices.map(({ side }) => side);

  beforeEach(() => {
    strategy = new DEMA();
    orders = new OrderRecorder();
    advices = orders.advices;
    logs = [];
    addIndicator = vi.fn();

    tools = {
      strategyParams: { period: 14, thresholds: { up: 0.5, down: -0.5 } },
      createOrder: orders.createOrder,
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

    // The bucket holds a candle of every watched pair, in the order of watch.assets: the strategy trades the first one only
    it.each`
      case           | pairs                       | expected
      ${'one pair'}  | ${['BTC/USDT']}             | ${[]}
      ${'two pairs'} | ${['BTC/USDT', 'ETH/USDT']} | ${[ETH_IGNORED_WARNING]}
    `('should warn once, at init, when it ignores watched pairs: $case', ({ pairs, expected }) => {
      expect(logsAtInit(new DEMA(), pairs, tools.strategyParams)).toEqual(expected);
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    // An uptrend, which buys once init has picked the pair
    it('should do nothing before init has picked the pair', () => {
      strategy = new DEMA();
      play('up');
      expect({ advices, logs }).toEqual({ advices: [], logs: [] });
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

    // Nothing logged either: a NaN result made a NaN diff, logged as no trend, and an infinite one an infinite trend, advised
    it.each`
      smaRes       | demaRes
      ${undefined} | ${undefined}
      ${1}         | ${undefined}
      ${undefined} | ${2}
      ${null}      | ${2}
      ${1}         | ${null}
      ${'invalid'} | ${2}
      ${NaN}       | ${2}
      ${1}         | ${NaN}
      ${Infinity}  | ${2}
      ${1}         | ${Infinity}
    `('should do nothing when results are invalid (sma: $smaRes, dema: $demaRes)', ({ smaRes, demaRes }) => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<DEMAStrategyParams>,
        { results: demaRes, symbol: 'BTC/USDT' },
        { results: smaRes, symbol: 'BTC/USDT' },
      );
      expect({ advices, logs }).toEqual({ advices: [], logs: [] });
    });

    // Unskipped, a null SMA would be subtracted as 0, a downtrend that sells, and a null DEMA would throw as the log message is built
    it.each`
      case                        | steps                       | expectedSides
      ${'a null SMA, when long'}  | ${'up completed:1 smaNull'} | ${['BUY']}
      ${'a null DEMA, when flat'} | ${'demaNull'}               | ${[]}
    `('should skip a candle whose DEMA or SMA is null, as one not ready yet: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it.each`
      case                                 | steps                    | expected
      ${'a BUY on an uptrend when flat'}   | ${'up'}                  | ${[allInBuy]}
      ${'a SELL on a downtrend when long'} | ${'up completed:1 down'} | ${[allInBuy, allInSell]}
    `('should emit an all-in STICKY order: $case', ({ steps, expected }) => {
      play(steps);
      expect(advices).toStrictEqual(expected);
    });

    it.each`
      case                                     | steps                                      | expectedSides
      ${'an uptrend that continues'}           | ${'up up up'}                              | ${['BUY']}
      ${'an uptrend after a neutral pause'}    | ${'up completed:1 neutral up'}             | ${['BUY']}
      ${'a downtrend when flat'}               | ${'down down'}                             | ${[]}
      ${'a downtrend while the BUY pends'}     | ${'up down down'}                          | ${['BUY']}
      ${'a downtrend once the BUY filled'}     | ${'up completed:1 down down'}              | ${['BUY', 'SELL']}
      ${'a BUY that fills during a downtrend'} | ${'up down completed:1 down'}              | ${['BUY', 'SELL']}
      ${'an uptrend while the SELL pends'}     | ${'up completed:1 down up up'}             | ${['BUY', 'SELL']}
      ${'a downtrend while the SELL pends'}    | ${'up completed:1 down up down'}           | ${['BUY', 'SELL']}
      ${'an uptrend once the SELL filled'}     | ${'up completed:1 down completed:2 up'}    | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL that fills during an uptrend'} | ${'up completed:1 down up completed:2 up'} | ${['BUY', 'SELL', 'BUY']}
    `('should advise once per position change on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
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

  describe('order outcomes', () => {
    // An outcome reports nothing of an execution, unless its step gives the BTC left free after it ('errored:2:0', see playSteps)
    it.each`
      case                                                       | steps                                            | expectedSides
      ${'a BUY completed: long, it sells'}                       | ${'up completed:1 down'}                         | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys on the next uptrend'}     | ${'up canceled:1 up neutral up down up'}         | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys on the next uptrend'}      | ${'up errored:1 up neutral up down up'}          | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys again'}                 | ${'up completed:1 down completed:2 up'}          | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells on the next downtrend'} | ${'up completed:1 down canceled:2 down up down'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells on the next downtrend'}  | ${'up completed:1 down errored:2 down up down'}  | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored, all sold: flat, it buys again'}         | ${'up completed:1 down errored:2:0 up'}          | ${['BUY', 'SELL', 'BUY']}
      ${'another order completed: still pending'}                | ${'up completed:unknown down up'}                | ${['BUY']}
      ${'another order canceled: still pending'}                 | ${'up canceled:unknown down up'}                 | ${['BUY']}
      ${'another order errored: still pending'}                  | ${'up errored:unknown down up'}                  | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });
  });

  describe('log', () => {
    it.each`
      smaRes       | demaRes      | expectedLogsLength
      ${undefined} | ${undefined} | ${0}
      ${1}         | ${undefined} | ${0}
      ${undefined} | ${2}         | ${0}
      ${null}      | ${2}         | ${0}
      ${1}         | ${null}      | ${0}
      ${NaN}       | ${2}         | ${0}
      ${1}         | ${-Infinity} | ${0}
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

  describe('schema', () => {
    // The documentation's example, without the name that labels the run: the manager parses the block without it
    const params = { period: 21, thresholds: { up: 0.0025, down: -0.0025 } };
    const withThresholds = (thresholds: object) => ({ ...params, thresholds: { ...params.thresholds, ...thresholds } });

    it.each`
      scenario                               | block
      ${'the documentation example'}         | ${params}
      ${'the block of the realtime configs'} | ${{ period: 12, thresholds: { up: 100, down: -150 } }}
    `('accepts $scenario as it is', ({ block }) => {
      expect(DEMA.schema.parse(block)).toEqual(block);
    });

    it.each`
      scenario                                     | block                                                              | missing                   | keys
      ${'a misspelt thresholds block (tresholds)'} | ${{ ...omit(params, 'thresholds'), tresholds: params.thresholds }} | ${['thresholds']}         | ${['tresholds']}
      ${'a misspelt threshold (dwon)'}             | ${{ ...params, thresholds: { up: 0.0025, dwon: -0.0025 } }}        | ${['thresholds', 'down']} | ${['dwon']}
    `('refuses $scenario', ({ block, missing, keys }) => {
      expect(DEMA.schema.safeParse(block).error?.issues).toMatchObject([
        { path: missing },
        { code: 'unrecognized_keys', keys, path: missing.slice(0, -1) },
      ]);
    });

    it.each`
      scenario                                  | block                               | path
      ${'a quoted period'}                      | ${{ ...params, period: '21' }}      | ${['period']}
      ${'a fractional period'}                  | ${{ ...params, period: 21.5 }}      | ${['period']}
      ${'a period of 1'}                        | ${{ ...params, period: 1 }}         | ${['period']}
      ${'a missing period'}                     | ${omit(params, 'period')}           | ${['period']}
      ${'a quoted threshold'}                   | ${withThresholds({ up: '0.0025' })} | ${['thresholds', 'up']}
      ${'a NaN threshold'}                      | ${withThresholds({ down: NaN })}    | ${['thresholds', 'down']}
      ${'a src (the DEMA strategy takes none)'} | ${{ ...params, src: 'close' }}      | ${[]}
    `('refuses $scenario', ({ block, path }) => {
      expect(DEMA.schema.safeParse(block).error?.issues).toMatchObject([{ path }]);
    });

    it('says why it refuses a period of 1', () => {
      expect(DEMA.schema.safeParse({ ...params, period: 1 }).error?.issues[0].message).toBe(
        'period must be at least 2 (the DEMA and the SMA of a single candle are both its close, so they never differ)',
      );
    });
  });
});
