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
      strategy.onTimeframeCandleAfterWarmup({ candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>, {
        results: indicatorRes,
        symbol,
      });
      expect(advices).toHaveLength(0);
    });

    it.each`
      case                         | results             | expectedCalls
      ${'bullish: strictly desc'}  | ${[50, 45, 40, 30]} | ${'long'}
      ${'not bullish: equal pair'} | ${[50, 50, 40, 30]} | ${''}
      ${'not bullish: asc step'}   | ${[30, 35, 33, 31]} | ${''}
    `('advises long when $case', ({ results, expectedCalls }) => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator(results),
      );

      if (expectedCalls) expect(advices).toEqual([expectedCalls === 'long' ? longAdvice : shortAdvice]);
      else expect(advices).toHaveLength(0);
    });

    it('goes long then flips short when spread is compressing', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([10, 9, 8, 7], 0.5),
      );
      strategy.onOrderCompleted({ order: { id: orders.ids[0] } } as any);
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([10, 11, 9, 8], 0.2),
      );

      expect(advices).toEqual([longAdvice, shortAdvice]);
    });

    it('does not reissue long while already long and still bullish', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([100, 90, 80], 0.5),
      );
      strategy.onOrderCompleted({ order: { id: orders.ids[0] } } as any);
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([90, 80, 70], 0.5),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([70, 60, 50], 0.5),
      );

      expect(advices).toEqual([longAdvice]);
    });
  });

  describe('order outcomes', () => {
    // Bullish ribbons (each EMA above the slower one) whose spread, below the threshold of 1, narrows from one to the next
    const RIBBONS = { tight: [10.5, 10.25, 10], tighter: [10.2, 10.1, 10], tightest: [10.1, 10.05, 10] } as const;

    /** Plays the steps (see playSteps): a ribbon (tight, tighter, tightest) is a candle, with the spread of its EMAs */
    const play = (steps: string) =>
      playSteps(steps, strategy, orders, step => {
        const results = [...RIBBONS[step as keyof typeof RIBBONS]];
        strategy.onTimeframeCandleAfterWarmup(
          { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
          ...makeIndicator(results, Math.max(...results) - Math.min(...results)),
        );
      });

    beforeEach(() => {
      strategy.init({ tools: { strategyParams: {} }, addIndicator, candle: bucket } as unknown as InitParams<EMARibbonStrategyParams>);
    });

    it.each`
      case                                        | steps                                              | expectedSides
      ${'a BUY completed: long, it sells'}        | ${'tight completed:1 tighter'}                     | ${['BUY', 'SELL']}
      ${'a BUY canceled: flat, it buys again'}    | ${'tight canceled:1 tight'}                        | ${['BUY', 'BUY']}
      ${'a BUY errored: flat, it buys again'}     | ${'tight errored:1 tight'}                         | ${['BUY', 'BUY']}
      ${'a SELL completed: flat, it buys again'}  | ${'tight completed:1 tighter completed:2 tight'}   | ${['BUY', 'SELL', 'BUY']}
      ${'a SELL canceled: long, it sells again'}  | ${'tight completed:1 tighter canceled:2 tightest'} | ${['BUY', 'SELL', 'SELL']}
      ${'a SELL errored: long, it sells again'}   | ${'tight completed:1 tighter errored:2 tightest'}  | ${['BUY', 'SELL', 'SELL']}
      ${'another order completed: still pending'} | ${'tight completed:unknown tight tighter'}         | ${['BUY']}
      ${'another order canceled: still pending'}  | ${'tight canceled:unknown tight tighter'}          | ${['BUY']}
      ${'another order errored: still pending'}   | ${'tight errored:unknown tight tighter'}           | ${['BUY']}
    `('should track $case', ({ steps, expectedSides }) => {
      play(steps);
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
