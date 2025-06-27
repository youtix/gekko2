import Big from 'big.js';
import { isFunction, map, mergeWith, reduce } from 'lodash-es';

const valuesMinusMeanSquared = (values: number[] = []) => {
  const average = mean(values);
  return map(values, val => Math.pow(val - average, 2));
};

export const stdev = (vals: number[] = []) => {
  // average squared deviation from mean
  return Math.sqrt(mean(valuesMinusMeanSquared(vals)));
};

/**
 * Linear-interpolated percentile (inclusive-range definition)
 *
 * @param values  data set (numbers only)
 * @param ptile   desired percentile.
 *                • Accepts 0 … 1  (e.g. 0.95)
 *                • or 0 … 100 (e.g. 95).
 *                  Anything > 1 is assumed to be a percentage and is divided by 100.
 * @returns the interpolated value, or NaN if the inputs are invalid
 */
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
  if (values.length !== weights.length || !values.length || sum(weights) === 0) throw new Error();
  return divide(reduce(mergeWith(values, weights, multiply), add, 0), sum(weights));
};

/** Least squares linear regression fitting. */
export const linreg = (valuesX: number[], valuesY: number[]) => {
  if (valuesX.length !== valuesY.length) throw new Error('The parameters valuesX and valuesY need to have same size!');

  const n = valuesX.length;
  if (n === 0) return [];

  // Calculate sums using Big.js for high-precision arithmetic.
  const sumX = reduce(valuesX, (acc, x) => acc.plus(Big(x)), Big(0));
  const sumY = reduce(valuesY, (acc, y) => acc.plus(Big(y)), Big(0));
  const sumXX = reduce(valuesX, (acc, x) => acc.plus(Big(x).times(Big(x))), Big(0));
  const sumXY = reduce(valuesX, (acc, x, i) => acc.plus(Big(x).times(Big(valuesY[i]))), Big(0));

  const count = Big(n);

  // Calculate slope (m) and intercept (b) with the formulas:
  // m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX^2)
  // b = (sumY / n) - m * (sumX / n)
  const numerator = count.times(sumXY).minus(sumX.times(sumY));
  const denominator = count.times(sumXX).minus(sumX.times(sumX));
  const m = numerator.div(denominator);
  const b = sumY.div(count).minus(m.times(sumX).div(count));

  return [+m, +b];
};

export const multiply = (a: number, b: number) => +Big(a).mul(b);
export const add = (a: number, b: number) => +Big(a).add(b);
export const divide = (a: number, b: number) => +Big(a).div(b);
export const sum = (values: number[]) => reduce(values, add, 0);
export const sumBy = <T>(values: T[], cond: keyof T | ((value: T) => number)) => {
  if (isFunction(cond)) return reduce(values, (p, c) => add(p, cond(c)), 0);
  else return reduce(values, (p, c) => add(p, c[cond] as number), 0);
};
export const mean = (values: number[] = []) => (!values?.length ? NaN : divide(reduce(values, add, 0), values.length));
