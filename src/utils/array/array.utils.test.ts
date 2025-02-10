import { describe, expect, it } from 'vitest';
import { keepDuplicates, removeDuplicates } from './array.utils';

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
