import { add, divide, map, mean, multiply, reduce, sum } from 'lodash-es';

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
  if (values.length !== weights.length || !values.length)
    throw new Error('Values and weights must be non-empty arrays of equal length');

  const totalWeight = sum(weights);
  if (totalWeight === 0) throw new Error('Sum of weights cannot be zero');

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
