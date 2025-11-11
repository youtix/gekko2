import { describe, expect, it } from 'vitest';
import { formatRatio, formatSignedAmount, formatSignedPercent, pluralize } from './string.utils';

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

describe('formatSignedAmount', () => {
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  it.each`
    value       | currency | expected
    ${150}      | ${'USD'} | ${'+150.00 USD'}
    ${-250.4}   | ${'USD'} | ${'-250.40 USD'}
    ${0}        | ${'USD'} | ${'0.00 USD'}
    ${1234.56}  | ${'EUR'} | ${'+1,234.56 EUR'}
    ${-9876.54} | ${'JPY'} | ${'-9,876.54 JPY'}
  `('formatSignedAmount($value, $currency) -> $expected', ({ value, currency, expected }) => {
    expect(formatSignedAmount(value, currency, formatter)).toBe(expected);
  });
});

describe('formatSignedPercent', () => {
  it.each`
    value        | expected
    ${null}      | ${'n/a'}
    ${undefined} | ${'n/a'}
    ${NaN}       | ${'n/a'}
    ${Infinity}  | ${'n/a'}
    ${-Infinity} | ${'n/a'}
    ${0}         | ${'0%'}
    ${0.004}     | ${'0%'}
    ${1.234}     | ${'+1.23%'}
    ${1.235}     | ${'+1.24%'}
    ${-1.235}    | ${'-1.24%'}
    ${-2.345}    | ${'-2.35%'}
  `('formatSignedPercent($value) -> $expected', ({ value, expected }) => {
    expect(formatSignedPercent(value)).toBe(expected);
  });
});
