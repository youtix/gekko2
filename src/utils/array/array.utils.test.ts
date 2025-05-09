import { describe, expect, it } from 'vitest';
import { isSorted, keepDuplicates, removeDuplicates } from './array.utils';

describe('removeDuplicates', () => {
  it.each`
    input                 | expected
    ${[1, 2, 2, 3, 4, 4]} | ${[1, 3]}
    ${[1, 1, 2, 2]}       | ${[]}
    ${[1, 2, 3, 4]}       | ${[1, 2, 3, 4]}
  `('should return $expected for input $input', ({ input, expected }) => {
    expect(removeDuplicates(input)).toEqual(expected);
  });
});

describe('keepDuplicates', () => {
  it.each`
    input                    | expected
    ${[1, 2, 2, 3, 4, 4]}    | ${[2, 4]}
    ${[1, 2, 3, 4]}          | ${[]}
    ${[1, 2, 2, 2, 3, 4, 4]} | ${[2, 4]}
  `('should return $expected for input $input', ({ input, expected }) => {
    expect(keepDuplicates(input)).toEqual(expected);
  });
});
describe('isSorted', () => {
  it.each`
    arr             | direction    | expected
    ${[]}           | ${'SAsc'}    | ${true}
    ${[1]}          | ${'Asc'}     | ${true}
    ${[1, 1, 2]}    | ${undefined} | ${false}
    ${[1, 2, 3]}    | ${undefined} | ${true}
    ${[1, 2, 3]}    | ${'SAsc'}    | ${true}
    ${[1, 2, 2, 3]} | ${'Asc'}     | ${true}
    ${[3, 2, 1, 1]} | ${'Desc'}    | ${true}
    ${[3, 2, 1, 1]} | ${'SDesc'}   | ${false}
    ${[1, 3, 2]}    | ${'SAsc'}    | ${false}
    ${[2, 2, 3]}    | ${'SAsc'}    | ${false}
    ${[1, 2, 3]}    | ${'SDesc'}   | ${false}
  `('returns $expected for $arr with direction=$direction', ({ arr, direction, expected }) => {
    expect(isSorted(arr, direction)).toBe(expected);
  });
});
