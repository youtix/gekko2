import { Portfolio } from '@models/portfolio.types';
import { Tag } from '@models/tag.types';
import { warning } from '@services/logger';
import {
  calculateAlpha,
  calculateAnnualizedReturnPct,
  calculateDownsideDeviation,
  calculateElapsedYears,
  calculateExposurePct,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateTotalReturnPct,
  RatioParams,
} from '@utils/finance/stats.utils';
import { stdev } from '@utils/math/math.utils';
import { differenceInMilliseconds, formatDuration, intervalToDuration } from 'date-fns';
import { MIN_ANNUALIZATION_HORIZON_MS } from './analyzer.const';
import { PerformanceStatistics, PerformanceStatisticsInput } from './analyzer.types';

/**
 * Whether the portfolio an order event carries was fetched from the exchange. The Trader sends the end of an order with the portfolio it
 * knows, read by the synchronization its report waits for, best effort: until one of its synchronizations succeeds, that is the empty
 * portfolio it starts with, while the balance of an exchange always lists the asset and the currency of every watched pair. Taken as
 * the latest portfolio, that empty one would value the account at 0, and give a start equity of 0 if the warmup completed then, which
 * leaves the report empty.
 */
export const isFetchedPortfolio = (portfolio: Portfolio): boolean => portfolio.size > 0;

/**
 * The statistics both analyzers report, computed the same way from their own period, equities and returns. The annualized return, the
 * annualized net profit and the Sharpe and Sortino ratios are annualized over one horizon: the period, or the day from its start when
 * it is shorter (see MIN_ANNUALIZATION_HORIZON_MS).
 */
export const calculatePerformanceStatistics = (input: PerformanceStatisticsInput, tag: Tag): PerformanceStatistics => {
  const { periodStartAt, periodEndAt, startEquity, endEquity, returns, marketReturnPct, exposureMs, riskFreeReturn } = input;
  const periodMs = differenceInMilliseconds(periodEndAt, periodStartAt);
  // The horizon in years of the calendar, as the period would be: from its start to its end, or to a day later for a shorter period
  const horizonYears = calculateElapsedYears(periodStartAt, Math.max(periodEndAt, periodStartAt + MIN_ANNUALIZATION_HORIZON_MS));
  if (periodMs < MIN_ANNUALIZATION_HORIZON_MS) {
    warning(
      tag,
      'Period shorter than a day: its annualized return and net profit, and its Sharpe and Sortino ratios, are computed over a day.',
    );
  }

  const netProfit = endEquity - startEquity;
  const totalReturnPct = calculateTotalReturnPct(endEquity, startEquity);
  const annualizedReturnPct = calculateAnnualizedReturnPct(totalReturnPct, horizonYears);
  const ratioParams: RatioParams = { returns, yearlyProfit: annualizedReturnPct, riskFreeReturn, elapsedYears: horizonYears };
  const volatility = stdev(returns);

  return {
    periodStartAt,
    periodEndAt,
    formattedDuration: formatDuration(intervalToDuration({ start: periodStartAt, end: periodEndAt })),
    netProfit,
    annualizedNetProfit: netProfit / horizonYears,
    totalReturnPct,
    annualizedReturnPct,
    marketReturnPct,
    alpha: calculateAlpha(totalReturnPct, marketReturnPct),
    // A run that ends with the bucket that completed the warmup has a period of 0 ms, and nothing exposed in it
    exposurePct: periodMs > 0 ? calculateExposurePct(exposureMs, periodMs) : 0,
    // Without any return, the standard deviation is NaN: there is no volatility to measure
    volatility: Number.isNaN(volatility) ? 0 : volatility,
    downsideDeviation: calculateDownsideDeviation(returns),
    sharpeRatio: calculateSharpeRatio(ratioParams),
    sortinoRatio: calculateSortinoRatio(ratioParams),
  };
};
