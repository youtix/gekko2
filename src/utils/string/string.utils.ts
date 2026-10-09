import { round } from '@utils/math/round.utils';
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

const ratioFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

export function formatRatio(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '';
  const rounded = Math.abs(x) < 0.005 ? 0 : x;
  return ratioFormatter.format(rounded);
}

// Amounts and prices span many orders of magnitude, from a balance in thousands to a PEPE price below 0.0001: eight fraction
// digits, down to a satoshi, keep the small ones from rounding to 0. The locale is explicit because Node formats with the one
// of the machine ('1 234,568' on a French one). 'negative' writes a value rounded to zero as 0, not -0.
const AMOUNT_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 8, signDisplay: 'negative' };
const amountFormatter = new Intl.NumberFormat('en-US', AMOUNT_FORMAT);
const plainNumberFormatter = new Intl.NumberFormat('en-US', { ...AMOUNT_FORMAT, useGrouping: false });

/** An amount or a price for a person to read, its thousands grouped: 1,234.5678, 0.0000012. */
export const formatAmount = (value: number): string => amountFormatter.format(value);

/**
 * A number for a program to read, such as a CSV cell: no grouping, a '.' separator and never an exponent (0.00000012, which
 * String writes 1.2e-7). Without a finite number it is '', where Intl would write NaN or ∞.
 */
export const toPlainNumber = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? plainNumberFormatter.format(value) : '';

export const formatSignedAmount = (value: number, currency: string, formatter: Intl.NumberFormat) => {
  const absolute = formatter.format(Math.abs(value));
  if (value > 0) return `+${absolute} ${currency}`;
  if (value < 0) return `-${absolute} ${currency}`;
  return `${absolute} ${currency}`;
};

export const formatSignedPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return 'n/a';
  const roundedValue = round(value, 2, 'halfEven');
  const absolute = Math.abs(roundedValue);
  if (roundedValue > 0) return `+${absolute}%`;
  if (roundedValue < 0) return `-${absolute}%`;
  return '0%';
};
