import { map, mean } from 'lodash-es';
import { countDecimals, round, shiftDecimalPoint } from './round.utils';

/** The significant digits a double keeps of any decimal: past them, a number computed in binary carries only noise */
const SIGNIFICANT_DIGITS = 15;

const valuesMinusMeanSquared = (values: number[] = []) => {
  const average = mean(values);
  return map(values, val => Math.pow(val - average, 2));
};

export const stdev = (vals: number[] = []) => {
  // average squared deviation from mean
  return Math.sqrt(mean(valuesMinusMeanSquared(vals)));
};

/**
 * a + b as the two are written: the double nearest to the sum of the decimals String gives them, where binary addition can come out an
 * ulp off it. 0.1 + 0.2 is 0.3, not 0.30000000000000004, and 2.5 - 2.2 is 0.3, not 0.2999999999999998, truncated to 0.29 on a step of
 * 0.01. For the amounts and prices that must come out as decimals: what an order leaves after its fills, the SELLs the Trader counts,
 * the prices of a grid. Exact while both, their decimal point moved to the decimals of the longer, and their sum are safe integers
 * (below 2 ** 53, about 15 significant digits); beyond, a + b. Scaled by a binary product, as they used to be, values of 16 or 17
 * significant digits came back further off than a + b (123456.78901234567 + 1e-8), and values of more than 308 decimals as NaN.
 */
export const addPrecise = (a: number, b: number): number => {
  const decimals = Math.max(countDecimals(a), countDecimals(b));
  const scaledA = shiftDecimalPoint(a, decimals);
  const scaledB = shiftDecimalPoint(b, decimals);
  const scaledSum = scaledA + scaledB;
  if (!Number.isSafeInteger(scaledA) || !Number.isSafeInteger(scaledB) || !Number.isSafeInteger(scaledSum)) return a + b;
  return shiftDecimalPoint(scaledSum, -decimals);
};

/**
 * a × b as the two are written: the double nearest to the product of their decimals, where the binary product can come out an ulp
 * off it (100.01 × 0.0004 is 0.040004000000000005, 0.040004 here). Exact while the product, written with the decimals of a and b
 * added up, has about 15 significant digits or fewer; beyond, as close as the binary product.
 */
export const multiplyPrecise = (a: number, b: number): number => round(a * b, countDecimals(a) + countDecimals(b));

/**
 * value to 15 significant digits (see SIGNIFICANT_DIGITS): the decimal it stands for, without the noise of the binary arithmetic that
 * made it, 0.07 for 0.06999999999999999. For a quotient, which no helper here works out exactly (a mean, a fee rate), and for a figure
 * made in binary upstream. A value of more significant digits loses them: 100.66666666666667 is 100.666666666667. NaN, an infinite
 * value and 0 are given back as they are.
 */
export const toSignificantDigits = (value: number): number => {
  if (!Number.isFinite(value) || value === 0) return value;
  // The exponent of the first digit as the value is written (6.999999999999999e-2). Math.log10 rounds up to the next integer for some
  // values just under a power of ten, which then kept a digit less: 9999999999.99998 came back as 10000000000
  const exponent = Number(value.toExponential().split('e')[1]);
  return round(value, SIGNIFICANT_DIGITS - 1 - exponent);
};

/**
 * Whether value is a number other than NaN, Infinity and -Infinity, as Number.isFinite tells, narrowing its type where
 * Number.isFinite does not. lodash's isNumber is true for NaN: a NaN indicator result passed the strategies' guards, then failed
 * every comparison, and the strategy silently never traded.
 */
export const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

/**
 * Compares a with b as Math.sign(a - b) does, but takes them as equal when they differ by at most `tolerance` times the larger of
 * their magnitudes: 1 when a is above b, -1 when below, 0 when equal, NaN when either is NaN. With a tolerance below 1, no value but
 * 0 is equal to 0, and an infinite value is equal only to itself.
 *
 * Values equal in exact arithmetic come out a few ulps apart, on either side, once computed apart: the running sum of an SMA leaves
 * it off the price of a flat window, and (p + p + p) / 3 is not p for 15 % of prices. Compared exactly, they were ordered by rounding
 * noise. The default tolerance, 1e-9, is:
 * - far above that noise: the running sum's error grows with the candles summed, about 1e-15 of the mean after a thousand, 2e-13
 *   after ten million (19 years of minutes), 1e-10 when the price fell a thousandfold over those ten million;
 * - far below a real difference: prices move by ticks of the order of 1e-7 of the price or more (0.01 on 100000), so two values
 *   within 1e-9 of each other are less than a hundredth of a tick apart, a touch rather than a cross.
 */
export const compareWithTolerance = (a: number, b: number, tolerance = 1e-9): number => {
  if (a === b) return 0;
  const difference = a - b;
  // Infinity times the tolerance is Infinity again: an infinite value would be within the tolerance of any finite one
  if (Number.isFinite(difference) && Math.abs(difference) <= tolerance * Math.max(Math.abs(a), Math.abs(b))) return 0;
  return Math.sign(difference);
};
