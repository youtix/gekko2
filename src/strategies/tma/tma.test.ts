import type { StrategyOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { LogLevel } from '@models/logLevel.types';
import { OrderRecorder, playSteps } from '@strategies/positionTracker.mock';
import { IndicatorResults, InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { omit } from 'lodash-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TMA } from './tma.strategy';
import { TMAStrategyParams } from './tma.types';

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({ short: 3, medium: 5, long: 8 }));
  return { config: new Configuration() };
});

const symbol = 'BTC/USDT';
// The short, medium and long SMAs of each alignment
const ALIGNMENTS = {
  up: [10, 5, 2],
  down: [3, 5, 2],
  bearish: [2, 5, 10],
} as const;

describe('TMA Strategy', () => {
  let strategy: TMA;
  let orders: OrderRecorder;
  let advices: StrategyOrder[];
  let logs: { level: LogLevel; message: string }[];
  let tools: any;
  let bucket: CandleBucket;
  let addIndicator: any;

  // The short, medium and long SMA results of a candle, in that order
  const onCandle = (...smas: unknown[]) =>
    strategy.onTimeframeCandleAfterWarmup(
      { candle: bucket, tools } as unknown as OnCandleEventParams<TMAStrategyParams>,
      ...smas.map((results): IndicatorResults<number | null> => ({ results: results as number | null, symbol })),
    );

  /** Plays the steps (see playSteps): an alignment (up, down, bearish) is a candle */
  const play = (steps: string) => playSteps(steps, strategy, orders, step => onCandle(...ALIGNMENTS[step as keyof typeof ALIGNMENTS]));

  beforeEach(() => {
    strategy = new TMA();
    orders = new OrderRecorder();
    advices = orders.advices;
    logs = [];
    addIndicator = vi.fn();

    tools = {
      strategyParams: { short: 3, medium: 5, long: 8, src: 'close' },
      createOrder: orders.createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn((level: LogLevel, message: string) => logs.push({ level, message })),
    };

    bucket = new Map();
    bucket.set(symbol, { close: 1 } as any);

    strategy.init({ candle: bucket, tools, addIndicator } as unknown as InitParams<TMAStrategyParams>);
  });

  describe('init', () => {
    it('should add three SMA indicators with correct periods and src', () => {
      expect(addIndicator.mock.calls).toEqual([
        ['SMA', symbol, { period: 3, src: 'close' }],
        ['SMA', symbol, { period: 5, src: 'close' }],
        ['SMA', symbol, { period: 8, src: 'close' }],
      ]);
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    it('should do nothing if pair is not defined', () => {
      const emptyStrategy = new TMA();
      emptyStrategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<TMAStrategyParams>,
        { results: 10, symbol },
        { results: 5, symbol },
        { results: 2, symbol },
      );
      expect(advices).toHaveLength(0);
    });

    it.each`
      shortRes     | mediumRes    | longRes
      ${undefined} | ${5}         | ${2}
      ${10}        | ${undefined} | ${2}
      ${10}        | ${5}         | ${undefined}
      ${'invalid'} | ${5}         | ${2}
    `(
      'should do nothing when results are invalid (short: $shortRes, med: $mediumRes, long: $longRes)',
      ({ shortRes, mediumRes, longRes }) => {
        onCandle(shortRes, mediumRes, longRes);
        expect(advices).toHaveLength(0);
      },
    );

    it('should emit a STICKY BUY advice on an uptrend when flat', () => {
      play('up');
      expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', amount: 1, symbol }]);
    });

    it('should log the long advice with the three SMAs', () => {
      play('up');
      expect(logs).toContainEqual({ level: 'info', message: 'Executing long advice due to detected uptrend: 10/5/2' });
    });

    it.each`
      shortRes | mediumRes | longRes
      ${3}     | ${5}      | ${2}
      ${5}     | ${3}      | ${7}
    `(
      'should emit a STICKY SELL advice when long and short=$shortRes, med=$mediumRes, long=$longRes',
      ({ shortRes, mediumRes, longRes }) => {
        play('up completed:1');
        onCandle(shortRes, mediumRes, longRes);
        expect(advices[1]).toEqual({ type: 'STICKY', side: 'SELL', amount: 1, symbol });
      },
    );

    it.each`
      shortRes | mediumRes | longRes
      ${3}     | ${5}      | ${2}
      ${5}     | ${3}      | ${7}
    `('should log the short advice when short=$shortRes, med=$mediumRes, long=$longRes', ({ shortRes, mediumRes, longRes }) => {
      play('up completed:1');
      onCandle(shortRes, mediumRes, longRes);
      expect(logs).toContainEqual({
        level: 'info',
        message: `Executing short advice due to detected downtrend: ${shortRes}/${mediumRes}/${longRes}`,
      });
    });

    it.each`
      case                                  | steps                                     | expectedSides
      ${'consecutive uptrend candles'}      | ${'up up up'}                             | ${['BUY']}
      ${'an uptrend while long'}            | ${'up completed:1 up up'}                 | ${['BUY']}
      ${'consecutive downtrend candles'}    | ${'up completed:1 down down down'}        | ${['BUY', 'SELL']}
      ${'a downtrend when flat'}            | ${'down down'}                            | ${[]}
      ${'a downtrend while the BUY pends'}  | ${'up down'}                              | ${['BUY']}
      ${'an uptrend while the SELL pends'}  | ${'up completed:1 down up'}               | ${['BUY', 'SELL']}
      ${'a downtrend once the SELL filled'} | ${'up completed:1 down completed:2 down'} | ${['BUY', 'SELL']}
      ${'a fully bearish alignment'}        | ${'up completed:1 bearish'}               | ${['BUY']}
    `('should advise once per position change on $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });

    it('should log debug when the alignment is fully bearish', () => {
      play('bearish');
      expect(logs).toContainEqual({ level: 'debug', message: 'No clear trend detected: 2/5/10' });
    });

    it('should not emit advice and log debug when no clear trend', () => {
      onCandle(5, 5, 5);
      expect(logs).toContainEqual({ level: 'debug', message: 'No clear trend detected: 5/5/5' });
    });
  });

  describe('order outcomes', () => {
    // An outcome reports nothing of an execution, unless its step gives the BTC left free after it ('errored:2:0', see playSteps)
    it.each`
      case                                               | steps                                    | expectedSides
      ${'a BUY completed: long, it sells'}               | ${'up completed:1 down'}                 | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys again'}           | ${'up canceled:1 up'}                    | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys again'}            | ${'up errored:1 up'}                     | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys again'}         | ${'up completed:1 down completed:2 up'}  | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells again'}         | ${'up completed:1 down canceled:2 down'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells again'}          | ${'up completed:1 down errored:2 down'}  | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored, all sold: flat, it buys again'} | ${'up completed:1 down errored:2:0 up'}  | ${['BUY', 'SELL', 'BUY']}
      ${'another order completed: still pending'}        | ${'up completed:unknown up down'}        | ${['BUY']}
      ${'another order canceled: still pending'}         | ${'up canceled:unknown up down'}         | ${['BUY']}
      ${'another order errored: still pending'}          | ${'up errored:unknown up down'}          | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });
  });

  describe('schema', () => {
    // The documentation's example, without the name that labels the run: the manager parses the block without it
    const params = { short: 10, medium: 21, long: 50, src: 'close' };

    it.each`
      scenario                               | block                  | expected
      ${'the documentation example'}         | ${params}              | ${params}
      ${'a block without src, on the close'} | ${omit(params, 'src')} | ${params}
    `('accepts $scenario', ({ block, expected }) => {
      expect(TMA.schema.parse(block)).toEqual(expected);
    });

    it('refuses a misspelt short (shrt)', () => {
      expect(TMA.schema.safeParse({ ...omit(params, 'short'), shrt: 10 }).error?.issues).toMatchObject([
        { path: ['short'] },
        { code: 'unrecognized_keys', keys: ['shrt'], path: [] },
      ]);
    });

    // A period of 0 is refused once, without the comparison of the periods
    it.each`
      scenario                                            | block                                        | path
      ${'a quoted medium'}                                | ${{ ...params, medium: '21' }}               | ${['medium']}
      ${'a fractional long'}                              | ${{ ...params, long: 50.5 }}                 | ${['long']}
      ${'a short of 0'}                                   | ${{ ...params, short: 0 }}                   | ${['short']}
      ${'a long of 0'}                                    | ${{ ...params, long: 0 }}                    | ${['long']}
      ${'swapped periods (50, 21, 10)'}                   | ${{ ...params, short: 50, long: 10 }}        | ${[]}
      ${'a short above the medium'}                       | ${{ ...params, short: 30 }}                  | ${[]}
      ${'a medium equal to the long'}                     | ${{ ...params, medium: 50 }}                 | ${[]}
      ${'an unknown source'}                              | ${{ ...params, src: 'hlc4' }}                | ${['src']}
      ${'a misspelt src (source), not left to the close'} | ${{ ...omit(params, 'src'), source: 'hl2' }} | ${[]}
    `('refuses $scenario', ({ block, path }) => {
      expect(TMA.schema.safeParse(block).error?.issues).toMatchObject([{ path }]);
    });

    it('says why it refuses swapped periods', () => {
      expect(TMA.schema.safeParse({ ...params, short: 50, long: 10 }).error?.issues[0].message).toBe(
        'short, medium and long must increase, short < medium < long (swapped periods give the opposite signal, equal ones none)',
      );
    });
  });
});
