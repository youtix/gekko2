/**
 * @fileoverview Financial and statistical utility functions for trading analysis.
 * All functions are pure, stateless, and throw errors for invalid inputs.
 */

import { EquitySnapshot } from '@models/event.types';
import { stdev } from '@utils/math/math.utils';
import { addYears, differenceInMilliseconds, differenceInYears } from 'date-fns';

// ============================================================================
// TYPES
// ============================================================================

/** Input for downside deviation calculation */
export interface DownsideDeviationInput {
  profits: number[];
}

// ============================================================================
// TIME CALCULATIONS
// ============================================================================

/**
 * Calculates elapsed years between two dates, accounting for leap years.
 * Uses precise fractional calculation for partial years.
 *
 * @param startDate - Start timestamp (epoch milliseconds)
 * @param endDate - End timestamp (epoch milliseconds)
 * @returns Elapsed time in years (fractional)
 * @throws Error if endDate is before startDate
 */
export const calculateElapsedYears = (startDate: number, endDate: number): number => {
  if (endDate < startDate) throw new Error('endDate must be greater than or equal to startDate');

  const fullYears = differenceInYears(endDate, startDate);
  const remainderStart = addYears(startDate, fullYears);
  const nextYearEnd = addYears(remainderStart, 1);
  const msInCurrentYear = differenceInMilliseconds(nextYearEnd, remainderStart);

  return fullYears + differenceInMilliseconds(endDate, remainderStart) / msInCurrentYear;
};

// ============================================================================
// RETURN CALCULATIONS
// ============================================================================

/**
 * Calculates total return as a percentage.
 *
 * @param currentEquity - Current portfolio value
 * @param startEquity - Initial portfolio value
 * @returns Total return percentage (e.g., 25.5 for 25.5%)
 * @throws Error if startEquity is zero or negative
 */
export const calculateTotalReturnPct = (currentEquity: number, startEquity: number): number => {
  if (startEquity <= 0) throw new Error('startEquity must be greater than zero');
  return (currentEquity / startEquity) * 100 - 100;
};

/**
 * Calculates annualized return percentage.
 *
 * @param totalReturnPct - Total return as percentage
 * @param elapsedYears - Time period in years
 * @returns Annualized return percentage
 * @throws Error if elapsedYears is zero or negative
 */
export const calculateAnnualizedReturnPct = (totalReturnPct: number, elapsedYears: number): number => {
  if (elapsedYears <= 0) throw new Error('elapsedYears must be greater than zero');
  return totalReturnPct / elapsedYears;
};

/**
 * Calculates market return percentage (buy-and-hold benchmark).
 *
 * @param endPrice - Price at end of period
 * @param startPrice - Price at start of period
 * @returns Market return percentage
 * @throws Error if startPrice is zero or negative
 */
export const calculateMarketReturnPct = (endPrice: number, startPrice: number): number => {
  if (startPrice <= 0) throw new Error('startPrice must be greater than zero');
  return ((endPrice - startPrice) / startPrice) * 100;
};

/**
 * Calculates alpha (excess return over benchmark).
 *
 * @param totalReturnPct - Strategy's total return percentage
 * @param marketReturnPct - Benchmark (market) return percentage
 * @returns Alpha as percentage points
 */
export const calculateAlpha = (totalReturnPct: number, marketReturnPct: number): number => {
  return totalReturnPct - marketReturnPct;
};

// ============================================================================
// EXPOSURE & WIN RATE
// ============================================================================

/**
 * Calculates exposure percentage (time in market).
 *
 * @param exposureMs - Total time exposed to market (milliseconds)
 * @param totalMs - Total period duration (milliseconds)
 * @returns Exposure as percentage (0-100)
 * @throws Error if totalMs is zero or negative
 */
export const calculateExposurePct = (exposureMs: number, totalMs: number): number => {
  if (totalMs <= 0) throw new Error('totalMs must be greater than zero');
  return (exposureMs / totalMs) * 100;
};

/**
 * Calculates win rate (percentage of profitable trades).
 *
 * @param winningTrades - Number of profitable trades
 * @param totalTrades - Total number of trades
 * @returns Win rate as percentage, or null if no trades
 */
export const calculateWinRate = (winningTrades: number, totalTrades: number): number | null => {
  if (totalTrades <= 0) return null;
  return (winningTrades / totalTrades) * 100;
};

// ============================================================================
// RISK METRICS
// ============================================================================

/**
 * Calculates downside deviation (volatility of negative returns only).
 * Uses root mean square of negative returns.
 *
 * @param profits - Array of profit percentages per trade
 * @returns Downside deviation as percentage
 */
export const calculateDownsideDeviation = (profits: number[]): number => {
  if (!profits.length) return 0;

  const sumSquaredDownside = profits.reduce((sum, profit) => (profit < 0 ? sum + Math.pow(profit, 2) : sum), 0);

  return Math.sqrt(sumSquaredDownside / profits.length);
};

/**
 * Extracts the top N largest Maximum Adverse Excursions (MAE).
 *
 * @param maes - Array of MAE values from round trips
 * @param limit - Maximum number of MAEs to return (default: 10)
 * @returns Sorted array of top MAE values (descending)
 */
export const extractTopMAEs = (maes: number[], limit: number = 10): number[] => {
  return maes
    .filter((value): value is number => Number.isFinite(value) && value >= 0)
    .sort((left, right) => right - left)
    .slice(0, limit);
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
export const calculateSharpeRatio = ({ returns, yearlyProfit, riskFreeReturn, elapsedYears }: RatioParams): number => {
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
export const calculateSortinoRatio = ({ returns, yearlyProfit, riskFreeReturn, elapsedYears }: RatioParams): number => {
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
export const calculateMaxDrawdown = (balances: number[], initialBalance: number): number => {
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

/**
 * Calculates the longest drawdown duration in milliseconds.
 * This is the longest time it takes for the portfolio to recover from a peak.
 *
 * @param samples - Array of EquitySnapshot samples in chronological order
 * @param initialBalance - The starting balance
 * @returns Longest drawdown duration in milliseconds
 */
export const calculateLongestDrawdownDuration = (samples: EquitySnapshot[], initialBalance: number): number => {
  if (!samples.length || initialBalance <= 0) return 0;

  let peak = initialBalance;
  let peakDate = samples[0]?.date ?? 0;
  let longestDuration = 0;
  let wasInDrawdown = false;

  for (const { date, totalValue } of samples) {
    if (totalValue < peak) {
      // We're in a drawdown
      wasInDrawdown = true;
    } else if (totalValue >= peak) {
      // New peak or recovery - calculate duration only if we were in a drawdown
      if (wasInDrawdown) {
        const duration = date - peakDate;
        if (duration > longestDuration) longestDuration = duration;
      }
      peak = totalValue;
      peakDate = date;
      wasInDrawdown = false;
    }
  }

  // Check if we're still in a drawdown at the end
  const lastSample = samples.at(-1);
  if (lastSample && wasInDrawdown) {
    const duration = lastSample.date - peakDate;
    if (duration > longestDuration) longestDuration = duration;
  }

  return longestDuration;
};
