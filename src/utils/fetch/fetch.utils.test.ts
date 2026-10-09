import { describe, expect, it } from 'vitest';
import { getRetryDelay } from './fetch.utils';

describe('getRetryDelay', () => {
  it.each`
    attempt | baseDelay | maxDelay | expected
    ${0}    | ${1000}   | ${3000}  | ${1000}
    ${1}    | ${1000}   | ${3000}  | ${1584.9625007211562}
    ${2}    | ${1000}   | ${3000}  | ${2000}
    ${10}   | ${1000}   | ${3000}  | ${3000}
    ${3}    | ${500}    | ${1500}  | ${1160.964047443681}
  `('returns $expected ms for attempt $attempt, baseDelay $baseDelay, maxDelay $maxDelay', ({ attempt, baseDelay, maxDelay, expected }) => {
    const result = getRetryDelay(attempt, baseDelay, maxDelay);
    expect(result).toBe(expected);
  });
});
