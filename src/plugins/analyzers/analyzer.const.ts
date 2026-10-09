import { hoursToMilliseconds } from 'date-fns';
import { PerformanceStatistics } from './analyzer.types';

export const ROUND = 8;

/**
 * The share of a position below which what is left of it is dust that no SELL can sell: an amount rounded down to the lot size of the
 * exchange, a BUY fee taken from the asset bought (as Binance does), both common in realtime. The RoundTripAnalyzer ends a round trip
 * once what is left of its position is at most this share of the amount its BUYs bought; the PortfolioAnalyzer counts an asset as held
 * only while it is worth at least this share of the portfolio (see its holdsAsset).
 */
export const DUST_TOLERANCE = 0.01;

/**
 * The shortest horizon the annualized figures extrapolate from: a day. Annualizing multiplies the return of the period by the number
 * of such periods in a year, about 66,000 for a period of 8 minutes: the moves of a few candles would make a yearly return of
 * thousands of %, with Sharpe and Sortino ratios to match. A day holds a whole cycle of crypto markets, which trade around the clock,
 * and caps that factor at 366; a longer horizon would understate the annualized figures of the runs of a few days, common in realtime.
 * A shorter period is annualized as if its returns had been spread over the day from its start: its annualized return, its annualized
 * net profit and its ratios alike, so that they agree with one another (see calculatePerformanceStatistics).
 */
export const MIN_ANNUALIZATION_HORIZON_MS = hoursToMilliseconds(24);

/** The statistics of a report without data to measure */
export const EMPTY_PERFORMANCE_STATISTICS: PerformanceStatistics = {
  periodStartAt: 0,
  periodEndAt: 0,
  formattedDuration: '',
  netProfit: 0,
  annualizedNetProfit: 0,
  totalReturnPct: 0,
  annualizedReturnPct: 0,
  marketReturnPct: 0,
  alpha: 0,
  exposurePct: 0,
  volatility: 0,
  downsideDeviation: 0,
  sharpeRatio: 0,
  sortinoRatio: 0,
};
