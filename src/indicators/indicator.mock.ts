import { mapValues } from 'lodash-es';
import { expect } from 'vitest';

/** A cell of an indicator's table: null while the indicator is not ready, else its number, or its object or array of numbers */
type ExpectedResult = null | number | ExpectedResult[] | { [field: string]: ExpectedResult };

/**
 * What toEqual must find for an indicator's result: null exactly where `expected` is null, and each number of `expected` within
 * `precision` digits, field by field in an object or an array. The tables used to assert with toBeCloseTo, which reads null as 0: a
 * null row passed when the indicator published 0 while it warmed up, as TRIX did, and a row of 0 passed when it published null.
 * expect.closeTo matches numbers only. As with it, a NaN matches nothing: assert one with toBe.
 */
export const approximately = (expected: ExpectedResult, precision: number): unknown => {
  if (expected === null) return null;
  if (Array.isArray(expected)) return expected.map(value => approximately(value, precision));
  if (typeof expected === 'object') return mapValues(expected, value => approximately(value, precision));
  return expect.closeTo(expected, precision);
};
