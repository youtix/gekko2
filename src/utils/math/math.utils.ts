import { add, divide, map, mean, multiply, reduce, sum } from 'lodash-es';
import { countDecimals, shiftDecimalPoint } from './round.utils';

const valuesMinusMeanSquared = (values: number[] = []) => {
  const average = mean(values);
  return map(values, val => Math.pow(val - average, 2));
};

export const stdev = (vals: number[] = []) => {
  // average squared deviation from mean
  return Math.sqrt(mean(valuesMinusMeanSquared(vals)));
};

export const weightedMean = (values: number[], weights: number[]): number => {
  if (values.length !== weights.length || !values.length) return NaN;

  const totalWeight = sum(weights);
  if (totalWeight === 0) return NaN;

  const numerator = reduce(values, (acc, v, i) => add(acc, multiply(v, weights[i])), 0);

  return divide(numerator, totalWeight);
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
