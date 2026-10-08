import { StrategyOrder } from '@models/advice.types';
import { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { OrderRecorder, playSteps } from '@strategies/positionTracker.mock';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { omit } from 'lodash-es';
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

// The CCI value of each step of the scenarios played below
const CCI_VALUES = { over: 150, under: -150, neutral: 50, nan: NaN } as const;

describe('CCI Strategy', () => {
  let strategy: CCI;
  let orders: OrderRecorder;
  let advices: StrategyOrder[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  /** Plays the steps (see playSteps): a CCI value (over, under, neutral) is a candle */
  const play = (steps: string) =>
    playSteps(steps, strategy, orders, step =>
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: CCI_VALUES[step as keyof typeof CCI_VALUES],
        symbol: 'BTC/USDT',
      }),
    );
  const sides = () => advices.map(({ side }) => side);

  beforeEach(() => {
    strategy = new CCI();
    orders = new OrderRecorder();
    advices = orders.advices;
    logs = [];
    addIndicator = vi.fn();

    tools = {
      strategyParams: { period: 14, thresholds: { up: 100, down: -100, persistence: 2 } },
      createOrder: orders.createOrder,
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

    // Nothing logged either: a NaN CCI failed both thresholds and ended the trend, and an infinite one started one
    it.each`
      cciRes
      ${undefined}
      ${'invalid'}
      ${null}
      ${NaN}
      ${Infinity}
      ${-Infinity}
    `('should do nothing when CCI result is invalid ($cciRes)', ({ cciRes }) => {
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<CCIStrategyParams>, {
        results: cciRes,
        symbol: 'BTC/USDT',
      });
      expect({ advices, logs }).toEqual({ advices: [], logs: [] });
    });

    it.each`
      case                            | steps                                      | expectedSides
      ${'within an oversold trend'}   | ${'under nan under'}                       | ${['BUY']}
      ${'within an overbought trend'} | ${'under under completed:1 over nan over'} | ${['BUY', 'SELL']}
    `('should skip a candle whose CCI is NaN, as one not ready yet: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
    });

    it.each`
      case                                         | steps                                                          | expectedSides
      ${'an overbought candle before persistence'} | ${'under under completed:1 over'}                              | ${['BUY']}
      ${'an overbought trend after persistence'}   | ${'under under completed:1 over over'}                         | ${['BUY', 'SELL']}
      ${'an overbought trend that continues'}      | ${'under under completed:1 over over over'}                    | ${['BUY', 'SELL']}
      ${'an oversold candle before persistence'}   | ${'under'}                                                     | ${[]}
      ${'an oversold trend after persistence'}     | ${'under under'}                                               | ${['BUY']}
      ${'an oversold trend that continues'}        | ${'under under under'}                                         | ${['BUY']}
      ${'a switch from overbought to oversold'}    | ${'under under completed:1 over over completed:2 under under'} | ${['BUY', 'SELL', 'BUY']}
      ${'an overbought trend when flat'}           | ${'over over over'}                                            | ${[]}
    `('should advise after persistence on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(sides()).toEqual(expectedSides);
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

    describe('persistence = 3', () => {
      beforeEach(() => {
        tools.strategyParams.thresholds.persistence = 3;
      });

      it.each`
        case                                    | steps                                             | expectedSides
        ${'two oversold candles'}               | ${'under under'}                                  | ${[]}
        ${'three oversold candles'}             | ${'under under under'}                            | ${['BUY']}
        ${'two overbought candles when long'}   | ${'under under under completed:1 over over'}      | ${['BUY']}
        ${'three overbought candles when long'} | ${'under under under completed:1 over over over'} | ${['BUY', 'SELL']}
      `('should wait for the third candle on $case', ({ steps, expectedSides }) => {
        play(steps);
        expect(sides()).toEqual(expectedSides);
      });
    });

    describe('persistence = 0', () => {
      beforeEach(() => {
        tools.strategyParams.thresholds.persistence = 0;
      });

      it('should emit a STICKY SELL advice immediately on overbought when long', () => {
        play('under completed:1 over');
        expect(advices[1]).toEqual({ type: 'STICKY', side: 'SELL', amount: 1, symbol: 'BTC/USDT' });
      });

      it('should emit a STICKY BUY advice immediately on oversold when flat', () => {
        play('under');
        expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol: 'BTC/USDT' }]);
      });

      it.each`
        case                                         | steps                                                | expectedSides
        ${'overbought trends when flat'}             | ${'over neutral over neutral over'}                  | ${[]}
        ${'overbought trends once sold'}             | ${'under completed:1 over completed:2 neutral over'} | ${['BUY', 'SELL']}
        ${'oversold trends while long'}              | ${'under completed:1 neutral under neutral under'}   | ${['BUY']}
        ${'oversold trends while the BUY pends'}     | ${'under neutral under'}                             | ${['BUY']}
        ${'an overbought trend while the BUY pends'} | ${'under over'}                                      | ${['BUY']}
        ${'an overbought trend once the BUY filled'} | ${'under over completed:1 over'}                     | ${['BUY', 'SELL']}
        ${'an oversold trend while the SELL pends'}  | ${'under completed:1 over under'}                    | ${['BUY', 'SELL']}
      `('should advise once per position change on $case', ({ steps, expectedSides }) => {
        play(steps);
        expect(sides()).toEqual(expectedSides);
      });

      // An outcome reports nothing of an execution, unless its step gives the BTC left free after it ('errored:2:0', see playSteps)
      it.each`
        case                                                   | steps                                                    | expectedSides
        ${'a BUY completed: long, it sells'}                   | ${'under completed:1 over'}                              | ${['BUY', 'SELL']}
        ${'a BUY canceled: flat, it buys on the next trend'}   | ${'under canceled:1 under neutral under'}                | ${['BUY', 'BUY']}
        ${'a BUY errored: flat, it buys on the next trend'}    | ${'under errored:1 under neutral under'}                 | ${['BUY', 'BUY']}
        ${'a SELL completed: flat, it buys again'}             | ${'under completed:1 over completed:2 under'}            | ${['BUY', 'SELL', 'BUY']}
        ${'a SELL canceled: long, it sells on the next trend'} | ${'under completed:1 over canceled:2 over neutral over'} | ${['BUY', 'SELL', 'SELL']}
        ${'a SELL errored: long, it sells on the next trend'}  | ${'under completed:1 over errored:2 over neutral over'}  | ${['BUY', 'SELL', 'SELL']}
        ${'a SELL errored, all sold: flat, it buys again'}     | ${'under completed:1 over errored:2:0 under'}            | ${['BUY', 'SELL', 'BUY']}
        ${'another order completed: still pending'}            | ${'under completed:unknown neutral under over'}          | ${['BUY']}
        ${'another order canceled: still pending'}             | ${'under canceled:unknown neutral under over'}           | ${['BUY']}
        ${'another order errored: still pending'}              | ${'under errored:unknown neutral under over'}            | ${['BUY']}
      `('should track $case', ({ steps, expectedSides }) => {
        play(steps);
        expect(sides()).toEqual(expectedSides);
      });
    });
  });

  describe('log', () => {
    it.each`
      cciRes       | expectedLogsLength
      ${undefined} | ${0}
      ${'invalid'} | ${0}
      ${NaN}       | ${0}
      ${Infinity}  | ${0}
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

  describe('schema', () => {
    // The documentation's example, without the name that labels the run: the manager parses the block without it
    const params = { period: 20, thresholds: { up: 100, down: -100, persistence: 0 } };
    const withThresholds = (thresholds: object) => ({ ...params, thresholds: { ...params.thresholds, ...thresholds } });

    it('accepts the documentation example as it is', () => {
      expect(CCI.schema.parse(params)).toEqual(params);
    });

    it.each`
      scenario                                     | block                                                                 | missing                          | keys
      ${'a misspelt persistence (persistance)'}    | ${{ ...params, thresholds: { up: 100, down: -100, persistance: 0 } }} | ${['thresholds', 'persistence']} | ${['persistance']}
      ${'a misspelt thresholds block (threshold)'} | ${{ ...omit(params, 'thresholds'), threshold: params.thresholds }}    | ${['thresholds']}                | ${['threshold']}
    `('refuses $scenario', ({ block, missing, keys }) => {
      expect(CCI.schema.safeParse(block).error?.issues).toMatchObject([
        { path: missing },
        { code: 'unrecognized_keys', keys, path: missing.slice(0, -1) },
      ]);
    });

    it.each`
      scenario                                | block                                   | path
      ${'a quoted period'}                    | ${{ ...params, period: '20' }}          | ${['period']}
      ${'a fractional period'}                | ${{ ...params, period: 20.5 }}          | ${['period']}
      ${'a period of 0'}                      | ${{ ...params, period: 0 }}             | ${['period']}
      ${'a period of 1'}                      | ${{ ...params, period: 1 }}             | ${['period']}
      ${'a missing period'}                   | ${omit(params, 'period')}               | ${['period']}
      ${'a quoted threshold'}                 | ${withThresholds({ up: '100' })}        | ${['thresholds', 'up']}
      ${'an infinite threshold'}              | ${withThresholds({ down: -Infinity })}  | ${['thresholds', 'down']}
      ${'a negative persistence'}             | ${withThresholds({ persistence: -1 })}  | ${['thresholds', 'persistence']}
      ${'a fractional persistence'}           | ${withThresholds({ persistence: 1.5 })} | ${['thresholds', 'persistence']}
      ${'a src, which the CCI does not take'} | ${{ ...params, src: 'close' }}          | ${[]}
    `('refuses $scenario', ({ block, path }) => {
      expect(CCI.schema.safeParse(block).error?.issues).toMatchObject([{ path }]);
    });

    it('says why it refuses a period of 1', () => {
      expect(CCI.schema.safeParse({ ...params, period: 1 }).error?.issues[0].message).toBe(
        'period must be at least 2 (the CCI of a single candle is always 0)',
      );
    });
  });
});
