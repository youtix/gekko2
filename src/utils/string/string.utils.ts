import { camelCase } from 'lodash-es';
import { END_Y_WORDS, IRREGULAR } from './string.const';

export const toCamelCase = (...args: string[]) => {
  return camelCase(args.join(' '));
};

export function pluralize(word: string, count: number, pluralForm?: string): string {
  if (count <= 1) return word;
  if (pluralForm) return pluralForm;

  const lower = word.toLowerCase();
  if (IRREGULAR[lower]) {
    return IRREGULAR[lower];
  }

  // “bus” → “buses”, “box” → “boxes”, “buzz” → “buzzes”
  if (['s', 'sh', 'ch', 'x', 'z'].some(end => lower.endsWith(end))) return `${word}es`;

  // “lady” → “ladies”
  if (END_Y_WORDS.some(end => lower.endsWith(end))) return `${word.slice(0, -1)}ies`;

  // default: just add “s”  (“cat” → “cats”)
  return `${word}s`;
}
