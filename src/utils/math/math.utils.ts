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

export interface RatioParams {
  returns: number[];
  yearlyProfit: number;
  riskFreeReturn: number;
  elapsedYears: number;
}

/**
 * Calculates the annualized Sharpe ratio.
 * Sharpe ratio measures risk-adjusted return using standard deviation of all returns.
 *
 * @param params.returns - Array of percentage returns per trade/period
 * @param params.yearlyProfit - Annualized profit percentage
 * @param params.riskFreeReturn - Risk-free rate of return (e.g., 1 for 1%)
 * @param params.elapsedYears - Total elapsed time in years
 * @returns Annualized Sharpe ratio
 */
export const sharpeRatio = ({ returns, yearlyProfit, riskFreeReturn, elapsedYears }: RatioParams): number => {
  if (!returns.length || elapsedYears <= 0) return 0;

  const volatility = stdev(returns);
  const standardDeviation = Number.isNaN(volatility) ? 0 : volatility;

  // Annualize volatility: multiply by sqrt(observations per year)
  const observationsPerYear = returns.length / elapsedYears;
  const annualizedStdDev = standardDeviation * Math.sqrt(observationsPerYear);

  return !annualizedStdDev ? 0 : (yearlyProfit - riskFreeReturn) / annualizedStdDev;
};

/**
 * Calculates the annualized Sortino ratio.
 * Sortino ratio measures risk-adjusted return using only downside deviation (negative returns).
 *
 * @param params.returns - Array of percentage returns per trade/period
 * @param params.yearlyProfit - Annualized profit percentage
 * @param params.riskFreeReturn - Risk-free rate of return (e.g., 1 for 1%)
 * @param params.elapsedYears - Total elapsed time in years
 * @returns Annualized Sortino ratio
 */
export const sortinoRatio = ({ returns, yearlyProfit, riskFreeReturn, elapsedYears }: RatioParams): number => {
  if (!returns.length || elapsedYears <= 0) return 0;

  const lossReturns = returns.filter(r => r < 0);
  if (!lossReturns.length) return 0;

  const downsideDeviation = stdev(lossReturns);
  if (!downsideDeviation || Number.isNaN(downsideDeviation)) return 0;

  // Annualize downside deviation: multiply by sqrt(observations per year)
  const observationsPerYear = returns.length / elapsedYears;
  const annualizedDownsideDev = downsideDeviation * Math.sqrt(observationsPerYear);

  return (yearlyProfit - riskFreeReturn) / Math.abs(annualizedDownsideDev);
};

/**
 * Calculates the maximum drawdown (MDD) as a percentage.
 * Maximum drawdown measures the largest peak-to-trough decline in portfolio value
 * before a new peak is reached.
 *
 * @param balances - Array of balance values in chronological order
 * @param initialBalance - The starting balance before the first sample
 * @returns Maximum drawdown as a positive percentage (0-100)
 */
export const maxDrawdown = (balances: number[], initialBalance: number): number => {
  if (!balances.length || initialBalance <= 0) return 0;

  const { maxDrawdown: result } = balances.reduce(
    (acc, balance) => {
      const peak = balance > acc.peak ? balance : acc.peak;
      const drawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
      return {
        peak,
        maxDrawdown: drawdown > acc.maxDrawdown ? drawdown : acc.maxDrawdown,
      };
    },
    { peak: initialBalance, maxDrawdown: 0 },
  );

  return result;
};
