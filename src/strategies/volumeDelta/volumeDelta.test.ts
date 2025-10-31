import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdviceOrder } from '@models/advice.types';
import type { UUID } from 'node:crypto';
import { VolumeDelta } from './volumeDelta.strategy';

describe('VolumeDelta Strategy', () => {
  let strategy: VolumeDelta;
  let advices: AdviceOrder[];
  let tools: any;

  const paramsBase = {
    src: 'quote' as const,
    short: 12,
    long: 26,
    signal: 9,
    output: 'volumeDelta' as const,
    thresholds: { up: 0.5, down: -0.5, persistence: 2 },
  };

  const makeIndicator = (
    output: 'volumeDelta' | 'macd' | 'signal' | 'hist',
    value: number | null,
  ): IndicatorRegistry['VolumeDelta']['output'] => ({
    volumeDelta: output === 'volumeDelta' ? value : null,
    macd: output === 'macd' ? value : null,
    signal: output === 'signal' ? value : null,
    hist: output === 'hist' ? value : null,
  });

  beforeEach(() => {
    strategy = new VolumeDelta();
    advices = [];
    const createOrder = vi.fn((order: AdviceOrder) => {
      advices.push({ ...order, quantity: order.quantity ?? 1 });
      return '00000000-0000-0000-0000-000000000000' as UUID;
    });
    tools = {
      candle: { close: 1 },
      strategyParams: { ...paramsBase },
      createOrder,
      cancelOrder: vi.fn(),
      log: vi.fn(),
    };
  });

  it.each`
    output           | value
    ${'volumeDelta'} | ${1}
    ${'macd'}        | ${1}
    ${'signal'}      | ${1}
    ${'hist'}        | ${1}
  `('emits long after persistence for $output', ({ output, value }) => {
    tools.strategyParams.output = output;
    strategy.onCandleAfterWarmup(tools, makeIndicator(output, value));
    expect(advices).toHaveLength(0);
    strategy.onCandleAfterWarmup(tools, makeIndicator(output, value));
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', quantity: 1 }]);
  });

  it.each`
    output           | value
    ${'volumeDelta'} | ${-1}
    ${'macd'}        | ${-1}
    ${'signal'}      | ${-1}
    ${'hist'}        | ${-1}
  `('emits short after persistence for $output', ({ output, value }) => {
    tools.strategyParams.output = output;
    strategy.onCandleAfterWarmup(tools, makeIndicator(output, value));
    expect(advices).toHaveLength(0);
    strategy.onCandleAfterWarmup(tools, makeIndicator(output, value));
    expect(advices).toEqual([{ type: 'STICKY', side: 'SELL', quantity: 1 }]);
  });

  it.each`
    label          | output           | value
    ${'uptrend'}   | ${'volumeDelta'} | ${1}
    ${'downtrend'} | ${'volumeDelta'} | ${-1}
  `('does not advise before persistence on $label', ({ output, value }) => {
    tools.strategyParams.output = output;
    strategy.onCandleAfterWarmup(tools, makeIndicator(output, value));
    expect(advices).toHaveLength(0);
  });

  it('advises only once per persisted trend', () => {
    tools.strategyParams.output = 'volumeDelta';
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', 1));
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', 1));
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', 1));
    expect(advices).toEqual([{ type: 'STICKY', side: 'BUY', quantity: 1 }]);
  });

  it('resets when switching trend and advises accordingly', () => {
    tools.strategyParams.output = 'volumeDelta';
    // Persist an uptrend -> long
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', 1));
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', 1));
    // Switch to a downtrend -> short
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', -1));
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', -1));
    expect(advices).toEqual([
      { type: 'STICKY', side: 'BUY', quantity: 1 },
      { type: 'STICKY', side: 'SELL', quantity: 1 },
    ]);
  });

  it.each`
    scenario                    | indicator
    ${'indicator is null'}      | ${null}
    ${'relevant field is null'} | ${makeIndicator('macd', null)}
  `('does nothing when $scenario', ({ indicator }) => {
    tools.strategyParams.output = 'macd';
    strategy.onCandleAfterWarmup(tools, indicator as any);
    expect(advices).toHaveLength(0);
  });
});
