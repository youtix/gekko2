import { describe, expect, it } from 'vitest';
import { formatAmount, formatRatio, formatSignedAmount, formatSignedPercent, pluralize, toPlainNumber } from './string.utils';

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

describe('formatAmount', () => {
  it.each`
    description                                | value           | expected
    ${'a large amount, its thousands grouped'} | ${1234567.5678} | ${'1,234,567.5678'}
    ${'a whole amount, without decimals'}      | ${100}          | ${'100'}
    ${'a tiny price'}                          | ${0.0000012}    | ${'0.0000012'}
    ${'a price below 1e-6, without exponent'}  | ${0.00000012}   | ${'0.00000012'}
    ${'an amount in BTC'}                      | ${0.00042}      | ${'0.00042'}
    ${'a loss in BTC'}                         | ${-0.00042}     | ${'-0.00042'}
    ${'an amount rounded to 8 decimals'}       | ${0.123456789}  | ${'0.12345679'}
    ${'a loss rounded to zero, without sign'}  | ${-0.000000001} | ${'0'}
  `('should write $description as $expected', ({ value, expected }) => {
    expect(formatAmount(value)).toBe(expected);
  });
});

describe('toPlainNumber', () => {
  it.each`
    description                               | value           | expected
    ${'a missing value'}                      | ${undefined}    | ${''}
    ${'a null value'}                         | ${null}         | ${''}
    ${'NaN'}                                  | ${NaN}          | ${''}
    ${'Infinity'}                             | ${Infinity}     | ${''}
    ${'-Infinity'}                            | ${-Infinity}    | ${''}
    ${'zero'}                                 | ${0}            | ${'0'}
    ${'a large amount, without grouping'}     | ${1234567.5678} | ${'1234567.5678'}
    ${'a large loss, without grouping'}       | ${-1234.5}      | ${'-1234.5'}
    ${'a huge amount, without exponent'}      | ${1e21}         | ${'1000000000000000000000'}
    ${'a tiny price'}                         | ${0.0000012}    | ${'0.0000012'}
    ${'a price below 1e-6, without exponent'} | ${0.00000012}   | ${'0.00000012'}
    ${'an amount in BTC'}                     | ${0.00042}      | ${'0.00042'}
    ${'an amount rounded to 8 decimals'}      | ${0.123456789}  | ${'0.12345679'}
    ${'a sum with floating-point noise'}      | ${0.1 + 0.2}    | ${'0.3'}
    ${'a loss rounded to zero, without sign'} | ${-0.000000001} | ${'0'}
  `('should write $description as $expected', ({ value, expected }) => {
    expect(toPlainNumber(value)).toBe(expected);
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
    ${-2.345}    | ${'-2.34%'}
  `('formatSignedPercent($value) -> $expected', ({ value, expected }) => {
    expect(formatSignedPercent(value)).toBe(expected);
  });
});
