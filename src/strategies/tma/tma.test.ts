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
const ULP = 2 ** -46; // the gap between 100 and the next double
// The short, medium and long SMAs of each alignment. On a flat stretch the SMAs holding only its price are equal in exact arithmetic,
// their running sums leave them a few ulps apart: 'flatRise' has the short one ulp above the medium, itself one ulp above the long,
// 'flatPeak' the medium one ulp above both others, 'flatDip' one ulp below both. In 'pairOver' and 'pairUnder' only the short and the
// medium hold the flat price, one ulp apart, the long still below or above it, and 'runningSums' are the SMAs 10, 21 and 50 that the
// running sums gave on the 26th candle of a stretch flat at 29864.4. 'tickRise' and 'tickPeak' are a tick apart: real alignments.
const ALIGNMENTS = {
  up: [10, 5, 2],
  down: [3, 5, 2],
  bearish: [2, 5, 10],
  flat: [100, 100, 100],
  flatRise: [100 + ULP, 100, 100 - ULP],
  flatPeak: [100 - ULP, 100, 100 - ULP],
  flatDip: [100 + ULP, 100, 100 + ULP],
  pairOver: [100 + ULP, 100, 99],
  pairUnder: [100 + ULP, 100, 101],
  runningSums: [29864.40000000007, 29864.40000000003, 29864.298399999956],
  tickRise: [100.02, 100.01, 100],
  tickPeak: [100, 100.01, 100],
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

    // Nothing logged either: a NaN SMA failed every comparison, read as no clear trend, and an infinite one made a trend
    it.each`
      shortRes     | mediumRes    | longRes
      ${undefined} | ${5}         | ${2}
      ${10}        | ${undefined} | ${2}
      ${10}        | ${5}         | ${undefined}
      ${'invalid'} | ${5}         | ${2}
      ${NaN}       | ${5}         | ${2}
      ${10}        | ${NaN}       | ${2}
      ${10}        | ${5}         | ${NaN}
      ${Infinity}  | ${5}         | ${2}
      ${10}        | ${5}         | ${-Infinity}
    `(
      'should do nothing when results are invalid (short: $shortRes, med: $mediumRes, long: $longRes)',
      ({ shortRes, mediumRes, longRes }) => {
        onCandle(shortRes, mediumRes, longRes);
        expect({ advices, logs }).toEqual({ advices: [], logs: [] });
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

  describe('on a flat stretch', () => {
    // Compared strictly, SMAs one ulp apart were ordered: an uptrend, or a mixed alignment read as a downtrend. The pair is the short
    // and the medium SMAs; long or flat, the position held when the stretch turns flat.
    it.each`
      case                                       | steps                                                     | expectedSides
      ${'three ulps apart, rising, when flat'}   | ${'flatRise'}                                             | ${[]}
      ${'pair ulps apart over long, when flat'}  | ${'pairOver'}                                             | ${[]}
      ${'running sums at 29864.4, when flat'}    | ${'runningSums'}                                          | ${[]}
      ${'medium ulps above both, when long'}     | ${'up completed:1 flatPeak'}                              | ${['BUY']}
      ${'medium ulps below both, when long'}     | ${'up completed:1 flatDip'}                               | ${['BUY']}
      ${'pair ulps apart under long, when long'} | ${'up completed:1 pairUnder'}                             | ${['BUY']}
      ${'long crossing the pair, when long'}     | ${'up completed:1 pairOver pairUnder pairOver pairUnder'} | ${['BUY']}
      ${'three SMAs equal, when long'}           | ${'up completed:1 flat'}                                  | ${['BUY']}
    `('should see no trend when two SMAs are within the tolerance: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });

    // The other pair: the medium and the long SMAs ulps apart, the short a real amount above or below them
    it.each`
      case                                       | setup               | smas                     | expectedSides
      ${'short above them, when flat'}           | ${''}               | ${[101, 100, 100 - ULP]} | ${[]}
      ${'short below, medium on top, when long'} | ${'up completed:1'} | ${[99, 100, 100 - ULP]}  | ${['BUY']}
      ${'short above, medium lowest, when long'} | ${'up completed:1'} | ${[101, 100, 100 + ULP]} | ${['BUY']}
    `('should see no trend when the medium and the long SMAs are within the tolerance: $case', ({ setup, smas, expectedSides }) => {
      play(setup);
      onCandle(...smas);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });

    it.each`
      case                                       | steps                                           | expectedSides
      ${'three a tick apart, rising, when flat'} | ${'tickRise'}                                   | ${['BUY']}
      ${'medium a tick above both, when long'}   | ${'up completed:1 tickPeak'}                    | ${['BUY', 'SELL']}
      ${'flat stretch, then uptrend, when flat'} | ${'flatRise pairOver tickRise'}                 | ${['BUY']}
      ${'flat stretch, downtrend, when long'}    | ${'up completed:1 flatPeak pairUnder tickPeak'} | ${['BUY', 'SELL']}
    `('should trade a real alignment: $case', ({ steps, expectedSides }) => {
      play(steps);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });

    it('should log no clear trend when two SMAs are within the tolerance', () => {
      play('pairOver');
      expect(logs).toContainEqual({ level: 'debug', message: `No clear trend detected: ${100 + ULP}/100/99` });
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
