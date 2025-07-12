import { describe, expect, it } from 'vitest';
import { pluralize } from './string.utils';

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
