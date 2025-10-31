import type { AdviceOrder } from '@models/advice.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UUID } from 'node:crypto';
import { EMARibbon } from './emaRibbon.strategy';

const makeIndicator = (results?: number[], spread = 0) => (results ? [{ results, spread }] : [undefined]);

describe('EMARibbon', () => {
  let strategy: EMARibbon;
  const addIndicator = vi.fn();
  const log = vi.fn();
  let advices: AdviceOrder[];
  let tools: any;
  const longAdvice: AdviceOrder = { type: 'STICKY', side: 'BUY', quantity: 1 };
  const shortAdvice: AdviceOrder = { type: 'STICKY', side: 'SELL', quantity: 1 };

  beforeEach(() => {
    strategy = new EMARibbon();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, quantity: order.quantity ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = { createOrder, log } as any;
  });

  it('init() adds the EMARibbon indicator with passed params', () => {
    const params = { src: 'close' as const, count: 6, start: 8, step: 2 };
    strategy.init(addIndicator, params);
    expect(addIndicator).toHaveBeenCalledWith('EMARibbon', { src: 'close', count: 6, start: 8, step: 2 });
  });

  it.each`
    case                         | results             | expectedCalls
    ${'bullish: strictly desc'}  | ${[50, 45, 40, 30]} | ${'long'}
    ${'not bullish: equal pair'} | ${[50, 50, 40, 30]} | ${''}
    ${'not bullish: asc step'}   | ${[30, 35, 33, 31]} | ${''}
  `('onCandleAfterWarmup advises long when $case', ({ results, expectedCalls }) => {
    strategy.onCandleAfterWarmup(tools, ...makeIndicator(results));

    if (expectedCalls) expect(advices).toEqual([expectedCalls === 'long' ? longAdvice : shortAdvice]);
    else expect(advices).toHaveLength(0);
  });

  it('onCandleAfterWarmup goes long then flips short when ribbon loses bullish order', () => {
    strategy.onCandleAfterWarmup(tools, ...makeIndicator([10, 9, 8, 7]));
    strategy.onCandleAfterWarmup(tools, ...makeIndicator([10, 11, 9, 8])); // break order

    expect(advices).toEqual([longAdvice, shortAdvice]);
  });

  it('onCandleAfterWarmup does nothing when indicator is missing', () => {
    strategy.onCandleAfterWarmup(tools, ...makeIndicator(undefined));

    expect(advices).toHaveLength(0);
  });

  it('onCandleAfterWarmup does not reissue long while already long and still bullish', () => {
    strategy.onCandleAfterWarmup(tools, ...makeIndicator([100, 90, 80]));
    strategy.onCandleAfterWarmup(tools, ...makeIndicator([90, 80, 70]));
    strategy.onCandleAfterWarmup(tools, ...makeIndicator([70, 60, 50]));

    expect(advices).toEqual([longAdvice]);
  });

  it('log() prints ribbon results and spread', () => {
    strategy.log(tools, ...makeIndicator([5, 4, 3], 0.42));

    expect(tools.log).toHaveBeenNthCalledWith(1, 'debug', 'Ribbon results: [5 / 4 / 3]');
    expect(tools.log).toHaveBeenNthCalledWith(2, 'debug', 'Ribbon Spread: 0.42');
  });

  it('end(), onEachCandle(), onOrderCompleted() are no-ops', () => {
    // These should not throw and should not log/advice.
    expect(() => {
      strategy.onEachCandle(tools);
      strategy.onOrderCompleted({} as any);
      strategy.end();
    }).not.toThrow();
  });
});
