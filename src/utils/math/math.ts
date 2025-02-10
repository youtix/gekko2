import Big from 'big.js';
import { map, mean, reduce, sortBy } from 'lodash-es';

const valuesMinusMeanSquared = (values: number[] = []) => {
  const average = mean(values);
  return map(values, (val) => Math.pow(+Big(val).minus(average), 2));
};

export const stdev = (vals: number[] = []) => {
  // average squared deviation from mean
  return Math.sqrt(mean(valuesMinusMeanSquared(vals)));
};

export const percentile = (values: number[] = [], ptile?: number) => {
  if (!values?.length || !ptile || ptile < 0) return NaN;

  // Fudge anything over 100 to 1.0
  const _ptile = ptile > 1 ? 1 : ptile;
  const vals = sortBy(values);
  const i = +Big(vals.length).mul(_ptile).minus(0.5);
  if ((i | 0) === i) return vals[i];
  // interpolated percentile -- using Estimation method
  const intPart = i | 0;
  const fract = Big(i).minus(intPart);
  return +Big(1)
    .minus(fract)
    .mul(vals[intPart])
    .plus(fract.mul(vals[Math.min(intPart + 1, vals.length - 1)]));
};

/**
 * Least squares linear regression fitting.
 *
 * @param {number[]} valuesX - Array of x values.
 * @param {number[]} valuesY - Array of y values.
 * @returns {[number, number]} A tuple [m, b] where m is the slope and b is the intercept.
 * @throws {Error} If the two arrays have different lengths.
 */
export const linreg = (valuesX: number[], valuesY: number[]) => {
  if (valuesX.length !== valuesY.length)
    throw new Error('The parameters valuesX and valuesY need to have same size!');

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
