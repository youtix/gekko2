import type { AdviceOrder, StrategyOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { OrderRecorder, playSteps } from '@strategies/positionTracker.mock';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import { omit } from 'lodash-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMARibbon } from './emaRibbon.strategy';
import { EMARibbonStrategyParams } from './emaRibbon.types';

const symbol = 'BTC/USDT';
const makeIndicator = (results?: number[], spread = 0) => [{ results: results ? { results, spread } : null, symbol }] as any;
/** The indicator's results for these EMAs, with their spread as the EMARibbon indicator computes it */
const ribbonOf = (emas: readonly number[]) => makeIndicator([...emas], Math.max(...emas) - Math.min(...emas));

describe('EMARibbon', () => {
  let strategy: EMARibbon;
  let addIndicator: any;
  let log: any;
  let orders: OrderRecorder;
  let advices: StrategyOrder[];
  let tools: any;
  let bucket: CandleBucket;
  const longAdvice = { type: 'STICKY', side: 'BUY', amount: 1, symbol } satisfies Partial<AdviceOrder>;
  const shortAdvice = { type: 'STICKY', side: 'SELL', amount: 1, symbol } satisfies Partial<AdviceOrder>;

  /**
   * Plays a timeframe candle as the StrategyManager does: onEachTimeframeCandle on every candle, the warmup included, then, once the
   * warmup is over, onTimeframeCandleAfterWarmup with the same results
   */
  const playCandle = (indicators: any[], afterWarmup = true) => {
    const params = { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>;
    strategy.onEachTimeframeCandle(params, ...indicators);
    if (afterWarmup) strategy.onTimeframeCandleAfterWarmup(params, ...indicators);
  };

  /**
   * Plays the steps (see playSteps): the name of one of the ribbons is a candle after the warmup, with the spread of its EMAs, the name
   * in parentheses a warmup candle, and 'none' a candle whose ribbon is not ready yet
   */
  const play = (steps: string, ribbons: Record<string, readonly number[]>) =>
    playSteps(steps, strategy, orders, step => {
      const isWarmup = step.startsWith('(') && step.endsWith(')');
      const name = isWarmup ? step.slice(1, -1) : step;
      if (name !== 'none' && !ribbons[name]) throw new Error(`No ribbon named ${name}, in "${steps}"`);
      playCandle(name === 'none' ? makeIndicator() : ribbonOf(ribbons[name]), !isWarmup);
    });

  beforeEach(() => {
    strategy = new EMARibbon();
    orders = new OrderRecorder();
    advices = orders.advices;
    addIndicator = vi.fn();
    log = vi.fn();
    tools = { createOrder: orders.createOrder, log, strategyParams: { spreadCompressionThreshold: 1 } } as any;

    bucket = new Map();
    bucket.set(symbol, { close: 100 } as any);
  });

  describe('init', () => {
    it('adds the EMARibbon indicator with passed params', () => {
      const params = { src: 'close' as const, count: 6, start: 8, step: 2 };
      strategy.init({ tools: { strategyParams: params }, addIndicator, candle: bucket } as unknown as InitParams<EMARibbonStrategyParams>);
      expect(addIndicator).toHaveBeenCalledWith('EMARibbon', symbol, { src: 'close', count: 6, start: 8, step: 2 });
    });
  });

  describe('onTimeframeCandleAfterWarmup', () => {
    beforeEach(() => {
      strategy.init({ tools: { strategyParams: {} }, addIndicator, candle: bucket } as unknown as InitParams<EMARibbonStrategyParams>);
    });

    it('does nothing if pair is not initialized', () => {
      const emptyStrategy = new EMARibbon();
      emptyStrategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([50, 45, 40]),
      );
      expect(advices).toHaveLength(0);
    });

    it.each`
      indicatorRes
      ${undefined}
      ${null}
    `('does nothing when indicator is missing or null ($indicatorRes)', ({ indicatorRes }) => {
      playCandle([{ results: indicatorRes, symbol }]);
      expect(advices).toHaveLength(0);
    });

    it.each`
      case                         | results             | expectedCalls
      ${'bullish: strictly desc'}  | ${[50, 45, 40, 30]} | ${'long'}
      ${'not bullish: equal pair'} | ${[50, 50, 40, 30]} | ${''}
      ${'not bullish: asc step'}   | ${[30, 35, 33, 31]} | ${''}
    `('advises long when $case', ({ results, expectedCalls }) => {
      playCandle(makeIndicator(results));

      if (expectedCalls) expect(advices).toEqual([expectedCalls === 'long' ? longAdvice : shortAdvice]);
      else expect(advices).toHaveLength(0);
    });

    it('goes long then flips short when spread is compressing', () => {
      playCandle(makeIndicator([10, 9, 8, 7], 0.5));
      strategy.onOrderCompleted({ order: { id: orders.ids[0] } } as any);
      playCandle(makeIndicator([10, 11, 9, 8], 0.2));

      expect(advices).toEqual([longAdvice, shortAdvice]);
    });

    it('does not reissue long while already long and still bullish', () => {
      playCandle(makeIndicator([100, 90, 80], 0.5));
      strategy.onOrderCompleted({ order: { id: orders.ids[0] } } as any);
      playCandle(makeIndicator([90, 80, 70], 0.5));
      playCandle(makeIndicator([70, 60, 50], 0.5));

      expect(advices).toEqual([longAdvice]);
    });
  });

  describe('order outcomes', () => {
    // Bullish ribbons (each EMA above the slower one) whose spread, below the threshold of 1, narrows from one to the next
    const RIBBONS = { tight: [10.5, 10.25, 10], tighter: [10.2, 10.1, 10], tightest: [10.1, 10.05, 10] } as const;

    beforeEach(() => {
      strategy.init({ tools: { strategyParams: {} }, addIndicator, candle: bucket } as unknown as InitParams<EMARibbonStrategyParams>);
    });

    // An outcome reports nothing of an execution, unless its step gives the BTC left free after it ('errored:2:0', see playSteps)
    it.each`
      case                                               | steps                                              | expectedSides
      ${'a BUY completed: long, it sells'}               | ${'tight completed:1 tighter'}                     | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys again'}           | ${'tight canceled:1 tight'}                        | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys again'}            | ${'tight errored:1 tight'}                         | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys again'}         | ${'tight completed:1 tighter completed:2 tight'}   | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells again'}         | ${'tight completed:1 tighter canceled:2 tightest'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells again'}          | ${'tight completed:1 tighter errored:2 tightest'}  | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored, all sold: flat, it buys again'} | ${'tight completed:1 tighter errored:2:0 tight'}   | ${['BUY', 'SELL', 'BUY']}
      ${'another order completed: still pending'}        | ${'tight completed:unknown tight tighter'}         | ${['BUY']}
      ${'another order canceled: still pending'}         | ${'tight canceled:unknown tight tighter'}          | ${['BUY']}
      ${'another order errored: still pending'}          | ${'tight errored:unknown tight tighter'}           | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps, RIBBONS);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });
  });

  describe('the first candle after the warmup', () => {
    const RIBBONS = {
      // EMAs 2, 3 and 4 as the StrategyManager computed them over closes rising by 2 from 100 through a warmup of 6 candles, spread 2
      // on its last three, then flat at 110: spread 1.47 on the candle after the warmup, 0.97 on the next
      rise4: [105, 104, 103],
      rise5: [107, 106, 105],
      rise6: [109, 108, 107],
      flat7: [109.66666666666667, 109, 108.2],
      flat8: [109.88888888888889, 109.5, 108.92],
      // The same EMAs after closes still rising, 112: spread 2 again; after a warmup flat at 100 (spread 0), a close of 103: spread 0.8
      rise7: [111, 110, 109],
      flat: [100, 100, 100],
      up: [102, 101.5, 101.2],
      // Spreads 3, 1 and 2
      wide: [103, 101.5, 100],
      narrow: [101, 100.5, 100],
      middle: [102, 101, 100],
    } as const;

    beforeEach(() => {
      tools.strategyParams.spreadCompressionThreshold = 100;
      strategy.init({ tools: { strategyParams: {} }, addIndicator, candle: bucket } as unknown as InitParams<EMARibbonStrategyParams>);
    });

    // A bullish ribbon below the threshold buys on the first candle after the warmup only if its spread has not narrowed since the
    // last warmup candle, as on any other candle
    it.each`
      case                                      | steps                                    | expectedSides
      ${'narrower than at the warmup end'}      | ${'(rise4) (rise5) (rise6) flat7'}       | ${[]}
      ${'then narrower again: no round trip'}   | ${'(rise4) (rise5) (rise6) flat7 flat8'} | ${[]}
      ${'as wide as at the warmup end'}         | ${'(rise4) (rise5) (rise6) rise7'}       | ${['BUY']}
      ${'wider than at the warmup end'}         | ${'(flat) (flat) (flat) up'}             | ${['BUY']}
      ${'wider than the last warmup candle'}    | ${'(wide) (narrow) middle'}              | ${['BUY']}
      ${'narrower than the last warmup candle'} | ${'(narrow) (wide) middle'}              | ${[]}
      ${'the first of the ribbon'}              | ${'(none) (none) flat7'}                 | ${['BUY']}
    `('advises $expectedSides when the spread is $case', ({ steps, expectedSides }) => {
      play(steps, RIBBONS);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });

    it('advises nothing during the warmup, even on a ribbon that would buy', () => {
      play('(flat) (up) (up)', RIBBONS);
      expect(advices).toHaveLength(0);
    });
  });

  describe('EMAs within the tolerance of each other', () => {
    const RIBBONS = {
      // EMAs 10 to 45 (step 5) after 612 candles flat at 30203.69 that followed a random walk: each one froze a few ulps short of the
      // price, one or two ulps above the next, and the spread stopped narrowing
      frozen: [
        30203.68999999999, 30203.689999999988, 30203.68999999998, 30203.689999999977, 30203.689999999973, 30203.689999999966,
        30203.689999999962, 30203.68999999996,
      ],
      // Each EMA 2e-9 above the next, beyond the tolerance (1e-9 of their magnitude)
      apart: [1 + 4e-9, 1 + 2e-9, 1],
      // The fastest two, or the slowest two, 5e-10 apart: within the tolerance
      fastPairWithin: [1.0000000005, 1, 0.9],
      slowPairWithin: [1.1, 1.0000000005, 1],
    } as const;

    beforeEach(() => {
      strategy.init({ tools: { strategyParams: {} }, addIndicator, candle: bucket } as unknown as InitParams<EMARibbonStrategyParams>);
    });

    it.each`
      case                                   | steps               | expectedSides
      ${'a ribbon frozen on a flat market'}  | ${'frozen frozen'}  | ${[]}
      ${'each EMA above the next beyond it'} | ${'apart'}          | ${['BUY']}
      ${'the fastest two within it'}         | ${'fastPairWithin'} | ${[]}
      ${'the slowest two within it'}         | ${'slowPairWithin'} | ${[]}
    `('advises $expectedSides for $case', ({ steps, expectedSides }) => {
      play(steps, RIBBONS);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });
  });

  describe('a spread within the tolerance of the one before', () => {
    const RIBBONS = {
      // EMAs 10 to 45 (step 5) on two candles in a row of a straight rise from 60000 by 3.33 a candle: in exact arithmetic the spread
      // stays 58.275, computed it fell by 1.25e-13 of itself
      rise47: [
        60141.52500000001, 60133.20000000001, 60124.87500000002, 60116.550000000025, 60108.22500000003, 60099.90000000002,
        60091.57500000001, 60083.25,
      ],
      rise48: [
        60144.855, 60136.53000000001, 60128.205000000016, 60119.88000000002, 60111.55500000002, 60103.230000000025, 60094.90500000001,
        60086.58,
      ],
      // Spread 1, then 2e-9 less (beyond the tolerance, 1e-9 of the spreads), or 5e-10 less (within)
      base: [2, 1.5, 1],
      beyond: [2 - 2e-9, 1.5, 1],
      within: [2 - 5e-10, 1.5, 1],
    } as const;

    beforeEach(() => {
      tools.strategyParams.spreadCompressionThreshold = 500;
      strategy.init({ tools: { strategyParams: {} }, addIndicator, candle: bucket } as unknown as InitParams<EMARibbonStrategyParams>);
    });

    // An order canceled reports nothing of an execution here: the strategy is flat again
    it.each`
      case                                 | steps                          | expectedSides
      ${'long, down by rounding noise'}    | ${'rise47 completed:1 rise48'} | ${['BUY']}
      ${'flat, down by rounding noise'}    | ${'rise47 canceled:1 rise48'}  | ${['BUY', 'BUY']}
      ${'long, down beyond the tolerance'} | ${'base completed:1 beyond'}   | ${['BUY', 'SELL']}
      ${'long, down within the tolerance'} | ${'base completed:1 within'}   | ${['BUY']}
      ${'flat, down beyond the tolerance'} | ${'base canceled:1 beyond'}    | ${['BUY']}
      ${'flat, down within the tolerance'} | ${'base canceled:1 within'}    | ${['BUY', 'BUY']}
    `('advises $expectedSides when $case', ({ steps, expectedSides }) => {
      play(steps, RIBBONS);
      expect(advices.map(({ side }) => side)).toEqual(expectedSides);
    });
  });

  describe('log', () => {
    beforeEach(() => {
      strategy.init({ tools: { strategyParams: {} }, addIndicator, candle: bucket } as unknown as InitParams<EMARibbonStrategyParams>);
    });

    it.each`
      indicatorRes
      ${undefined}
      ${null}
    `('does not log when indicator result is missing or null ($indicatorRes)', ({ indicatorRes }) => {
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>, { results: indicatorRes, symbol });
      expect(tools.log).not.toHaveBeenCalled();
    });

    it('prints ribbon results and spread', () => {
      strategy.log({ candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>, ...makeIndicator([5, 4, 3], 0.42));

      expect(tools.log).toHaveBeenNthCalledWith(1, 'debug', 'Ribbon results: [5 / 4 / 3]');
      expect(tools.log).toHaveBeenNthCalledWith(2, 'debug', 'Ribbon Spread: 0.42');
    });
  });

  describe('schema', () => {
    // The documentation's example, without the name that labels the run: the manager parses the block without it
    const params = { src: 'close', count: 8, start: 10, step: 5, spreadCompressionThreshold: 500 };

    it.each`
      scenario                                                      | block                         | expected
      ${'the documentation example'}                                | ${params}                     | ${params}
      ${'a source of the indicator besides close and ohlc4 (hlc3)'} | ${{ ...params, src: 'hlc3' }} | ${{ ...params, src: 'hlc3' }}
      ${'a block without src, on the close'}                        | ${omit(params, 'src')}        | ${params}
    `('accepts $scenario', ({ block, expected }) => {
      expect(EMARibbon.schema.parse(block)).toEqual(expected);
    });

    it('refuses a misspelt spreadCompressionThreshold (spreadCompresionThreshold)', () => {
      const { spreadCompressionThreshold: spreadCompresionThreshold, ...ribbon } = params;
      expect(EMARibbon.schema.safeParse({ ...ribbon, spreadCompresionThreshold }).error?.issues).toMatchObject([
        { path: ['spreadCompressionThreshold'] },
        { code: 'unrecognized_keys', keys: ['spreadCompresionThreshold'], path: [] },
      ]);
    });

    it.each`
      scenario                                            | block                                                  | path
      ${'a quoted count'}                                 | ${{ ...params, count: '8' }}                           | ${['count']}
      ${'a count of 1'}                                   | ${{ ...params, count: 1 }}                             | ${['count']}
      ${'a fractional count'}                             | ${{ ...params, count: 7.5 }}                           | ${['count']}
      ${'a fractional start'}                             | ${{ ...params, start: 10.5 }}                          | ${['start']}
      ${'a start of 0'}                                   | ${{ ...params, start: 0 }}                             | ${['start']}
      ${'a fractional step'}                              | ${{ ...params, step: 1.5 }}                            | ${['step']}
      ${'a step of 0'}                                    | ${{ ...params, step: 0 }}                              | ${['step']}
      ${'an unknown source'}                              | ${{ ...params, src: 'median' }}                        | ${['src']}
      ${'a misspelt src (source), not left to the close'} | ${{ ...omit(params, 'src'), source: 'hl2' }}           | ${[]}
      ${'a quoted threshold'}                             | ${{ ...params, spreadCompressionThreshold: '500' }}    | ${['spreadCompressionThreshold']}
      ${'an infinite threshold'}                          | ${{ ...params, spreadCompressionThreshold: Infinity }} | ${['spreadCompressionThreshold']}
    `('refuses $scenario', ({ block, path }) => {
      expect(EMARibbon.schema.safeParse(block).error?.issues).toMatchObject([{ path }]);
    });

    it('says why it refuses a count of 1', () => {
      expect(EMARibbon.schema.safeParse({ ...params, count: 1 }).error?.issues[0].message).toBe(
        'count must be at least 2 (the spread of a single EMA is always 0)',
      );
    });
  });
});
