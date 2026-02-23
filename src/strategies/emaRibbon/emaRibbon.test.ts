import type { AdviceOrder } from '@models/advice.types';
import type { CandleBucket } from '@models/event.types';
import { InitParams, OnCandleEventParams } from '@strategies/strategy.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMARibbon } from './emaRibbon.strategy';
import { EMARibbonStrategyParams } from './emaRibbon.types';

const symbol = 'BTC/USDT';
const makeIndicator = (results?: number[], spread = 0) => [{ results: results ? { results, spread } : null, symbol }] as any;

describe('EMARibbon', () => {
  let strategy: EMARibbon;
  let addIndicator: any;
  let log: any;
  let advices: AdviceOrder[];
  let tools: any;
  let bucket: CandleBucket;
  const longAdvice = { type: 'STICKY', side: 'BUY', amount: 1, symbol } satisfies Partial<AdviceOrder>;
  const shortAdvice = { type: 'STICKY', side: 'SELL', amount: 1, symbol } satisfies Partial<AdviceOrder>;

  beforeEach(() => {
    strategy = new EMARibbon();
    advices = [];
    addIndicator = vi.fn();
    log = vi.fn();
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = { createOrder, log } as any;

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

    it('goes long then flips short when ribbon loses bullish order', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([10, 9, 8, 7]),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([10, 11, 9, 8]),
      );

      expect(advices).toEqual([longAdvice, shortAdvice]);
    });

    it('does not reissue long while already long and still bullish', () => {
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([100, 90, 80]),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([90, 80, 70]),
      );
      strategy.onTimeframeCandleAfterWarmup(
        { candle: bucket, tools } as unknown as OnCandleEventParams<EMARibbonStrategyParams>,
        ...makeIndicator([70, 60, 50]),
      );

      expect(advices).toEqual([longAdvice]);
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
});
