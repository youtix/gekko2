import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VolumeDelta } from './volumeDelta.strategy';

describe('VolumeDelta Strategy', () => {
  let strategy: VolumeDelta;
  let advices: string[];
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
    tools = {
      candle: { close: 1 },
      strategyParams: { ...paramsBase },
      advice: (direction: string) => advices.push(direction),
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
    expect(advices).toEqual(['long']);
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
    expect(advices).toEqual(['short']);
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
    expect(advices).toEqual(['long']);
  });

  it('resets when switching trend and advises accordingly', () => {
    tools.strategyParams.output = 'volumeDelta';
    // Persist an uptrend -> long
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', 1));
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', 1));
    // Switch to a downtrend -> short
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', -1));
    strategy.onCandleAfterWarmup(tools, makeIndicator('volumeDelta', -1));
    expect(advices).toEqual(['long', 'short']);
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
