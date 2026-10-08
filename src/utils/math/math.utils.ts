import { add, divide, map, mean, multiply, reduce, sum } from 'lodash-es';

const valuesMinusMeanSquared = (values: number[] = []) => {
  const average = mean(values);
  return map(values, val => Math.pow(val - average, 2));
};

export const stdev = (vals: number[] = []) => {
  // average squared deviation from mean
  return Math.sqrt(mean(valuesMinusMeanSquared(vals)));
};

export const percentile = (values: number[] = [], ptile?: number): number => {
  if (!values?.length || ptile === undefined || ptile < 0) return NaN;

  // Convert 0–100 → 0–1
  let p = ptile;
  if (p > 1) p /= 100;
  if (p > 1) p = 1;

  // Sort ascending without mutating the caller’s array
  const vals = [...values].sort((a, b) => a - b);

  // Exact endpoints
  if (p === 0) return vals[0];
  if (p === 1) return vals[vals.length - 1];

  // Rank-based interpolation: (n-1) · p
  const rank = (vals.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;

  // Linear interpolate between the two bracketing values
  return vals[lower] * (1 - weight) + vals[upper] * weight;
};

export const weightedMean = (values: number[], weights: number[]): number => {
  if (values.length !== weights.length || !values.length) return NaN;

  const totalWeight = sum(weights);
  if (totalWeight === 0) return NaN;

  const numerator = reduce(values, (acc, v, i) => add(acc, multiply(v, weights[i])), 0);

  return divide(numerator, totalWeight);
};

/** Least squares linear regression fitting. */
export const linreg = (valuesX: number[], valuesY: number[]): [number, number] | [] => {
  if (valuesX.length !== valuesY.length) throw new Error('The parameters valuesX and valuesY need to have same size!');

  const n = valuesX.length;
  if (n === 0) return [];

  const sumX = reduce(valuesX, (acc, x) => acc + x, 0);
  const sumY = reduce(valuesY, (acc, y) => acc + y, 0);
  const sumXX = reduce(valuesX, (acc, x) => acc + x * x, 0);
  const sumXY = reduce(valuesX, (acc, x, i) => acc + x * valuesY[i], 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) return [NaN, NaN]; // Degenerate case (vertical line)

  const m = numerator / denominator;
  const b = sumY / n - m * (sumX / n);

  return [m, b];
};

export const addPrecise = (a: number, b: number) => {
  const [aDecimals, bDecimals] = [a, b].map(countDecimals);
  const factor = 10 ** Math.max(aDecimals, bDecimals);

  const result = (Math.round(a * factor) + Math.round(b * factor)) / factor;
  return result;
};

const countDecimals = (num: number) => {
  const s = num.toString();
  if (s.includes('e')) {
    // Handle scientific notation like 1e-7
    const [base, exp] = s.split('e');
    return Math.max(0, (base.split('.')[1]?.length || 0) - Number(exp));
  }
  return s.split('.')[1]?.length || 0;
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
