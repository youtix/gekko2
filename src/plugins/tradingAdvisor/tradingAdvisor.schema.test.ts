import { describe, expect, it } from 'vitest';
import { tradingAdvisorSchema } from './tradingAdvisor.schema';

const entry = { name: 'TradingAdvisor', strategyName: 'DEMA' };
const allOptions = { strategyPath: './my.strategy.ts', maxConsecutiveErrors: -1 };

describe('tradingAdvisorSchema', () => {
  it.each`
    scenario                                        | options       | expected
    ${'the required options, with the default 5'}   | ${{}}         | ${{ ...entry, maxConsecutiveErrors: 5 }}
    ${'every option, the circuit breaker disabled'} | ${allOptions} | ${{ ...entry, ...allOptions }}
  `('accepts $scenario', ({ options, expected }) => {
    expect(tradingAdvisorSchema.parse({ ...entry, ...options })).toEqual(expected);
  });

  // A stripped option would leave its default in place: maxConsecutiveError: -1 would keep the circuit breaker at 5 errors
  it.each`
    scenario                                     | options                                            | keys
    ${'a misspelt option (maxConsecutiveError)'} | ${{ maxConsecutiveError: -1 }}                     | ${['maxConsecutiveError']}
    ${'an option of the Trader plugin'}          | ${{ portfolioUpdates: { threshold: 1, dust: 1 } }} | ${['portfolioUpdates']}
  `('refuses $scenario', ({ options, keys }) => {
    expect(tradingAdvisorSchema.safeParse({ ...entry, ...options }).error?.issues).toMatchObject([
      { code: 'unrecognized_keys', keys, path: [] },
    ]);
  });
});
