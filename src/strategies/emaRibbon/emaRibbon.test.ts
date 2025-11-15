import type { AdviceOrder } from '@models/advice.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMARibbon } from './emaRibbon.strategy';

const makeIndicator = (results?: number[], spread = 0) => (results ? [{ results, spread }] : [undefined]);

describe('EMARibbon', () => {
  let strategy: EMARibbon;
  const addIndicator = vi.fn();
  const log = vi.fn();
  let advices: AdviceOrder[];
  let tools: any;
  const longAdvice = { type: 'STICKY', side: 'BUY', amount: 1 } satisfies Partial<AdviceOrder>;
  const shortAdvice = { type: 'STICKY', side: 'SELL', amount: 1 } satisfies Partial<AdviceOrder>;

  beforeEach(() => {
    strategy = new EMARibbon();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, amount: order.amount ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = { createOrder, log } as any;
  });

  it('init() adds the EMARibbon indicator with passed params', () => {
    const params = { src: 'close' as const, count: 6, start: 8, step: 2 };
    strategy.init({ tools: { strategyParams: params }, addIndicator } as any);
    expect(addIndicator).toHaveBeenCalledWith('EMARibbon', { src: 'close', count: 6, start: 8, step: 2 });
  });

  it.each`
    case                         | results             | expectedCalls
    ${'bullish: strictly desc'}  | ${[50, 45, 40, 30]} | ${'long'}
    ${'not bullish: equal pair'} | ${[50, 50, 40, 30]} | ${''}
    ${'not bullish: asc step'}   | ${[30, 35, 33, 31]} | ${''}
  `('onCandleAfterWarmup advises long when $case', ({ results, expectedCalls }) => {
    strategy.onTimeframeCandleAfterWarmup({ tools } as any, ...makeIndicator(results));

    if (expectedCalls) expect(advices).toEqual([expectedCalls === 'long' ? longAdvice : shortAdvice]);
    else expect(advices).toHaveLength(0);
  });

  it('onCandleAfterWarmup goes long then flips short when ribbon loses bullish order', () => {
    strategy.onTimeframeCandleAfterWarmup({ tools } as any, ...makeIndicator([10, 9, 8, 7]));
    strategy.onTimeframeCandleAfterWarmup({ tools } as any, ...makeIndicator([10, 11, 9, 8])); // break order

    expect(advices).toEqual([longAdvice, shortAdvice]);
  });

  it('onCandleAfterWarmup does nothing when indicator is missing', () => {
    strategy.onTimeframeCandleAfterWarmup({ tools } as any, ...makeIndicator(undefined));

    expect(advices).toHaveLength(0);
  });

  it('onCandleAfterWarmup does not reissue long while already long and still bullish', () => {
    strategy.onTimeframeCandleAfterWarmup({ tools } as any, ...makeIndicator([100, 90, 80]));
    strategy.onTimeframeCandleAfterWarmup({ tools } as any, ...makeIndicator([90, 80, 70]));
    strategy.onTimeframeCandleAfterWarmup({ tools } as any, ...makeIndicator([70, 60, 50]));

    expect(advices).toEqual([longAdvice]);
  });

  it('log() prints ribbon results and spread', () => {
    strategy.log({ tools } as any, ...makeIndicator([5, 4, 3], 0.42));

    expect(tools.log).toHaveBeenNthCalledWith(1, 'debug', 'Ribbon results: [5 / 4 / 3]');
    expect(tools.log).toHaveBeenNthCalledWith(2, 'debug', 'Ribbon Spread: 0.42');
  });

  it('end(), onEachCandle(), onOrderCompleted() are no-ops', () => {
    // These should not throw and should not log/advice.
    expect(() => {
      strategy.onEachTimeframeCandle({ tools } as any);
      strategy.onOrderCompleted({ tools } as any);
      strategy.end();
    }).not.toThrow();
  });
});
