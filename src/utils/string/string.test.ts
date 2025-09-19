import { describe, expect, it } from 'vitest';
import { formatRatio, pluralize } from './string.utils';

const cases: [string, number, string, string?][] = [
  ['cat', 0, 'cat'],
  ['cat', 1, 'cat'],
  ['cat', 2, 'cats'],
  ['bus', 2, 'buses'],
  ['box', 3, 'boxes'],
  ['lady', 4, 'ladies'],
  ['child', 2, 'children'],
  ['person', 5, 'people'],
  ['octopus', 5, 'octopi', 'octopi'],
  ['sheep', 2, 'sheep'],
];

describe('pluralize', () => {
  it.each(cases)('%s x %i → %s', (word, count, expected, explicit) => {
    expect(pluralize(word, count, explicit)).toBe(expected);
  });
});

describe('formatRatio', () => {
  it.each`
    value        | expected
    ${null}      | ${''}
    ${undefined} | ${''}
    ${NaN}       | ${''}
    ${0}         | ${'0.00'}
    ${0.004}     | ${'0.00'}
    ${-0.004}    | ${'0.00'}
    ${0.005}     | ${'0.01'}
    ${-0.005}    | ${'-0.01'}
    ${1}         | ${'1.00'}
    ${1.234}     | ${'1.23'}
    ${1.235}     | ${'1.24'}
    ${-2.345}    | ${'-2.35'}
  `('formatRatio($value) -> $expected', ({ value, expected }) => {
    expect(formatRatio(value)).toBe(expected);
  });
});
