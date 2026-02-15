import { PortfolioReport } from './portfolioAnalyzer.types';

/** Plugin name constant */
export const PLUGIN_NAME = 'PortfolioAnalyzer';

/** Empty trading report for zero-trade scenarios */
export const EMPTY_PORTFOLIO_REPORT: PortfolioReport = {
  id: 'PORTFOLIO PROFIT REPORT',
  alpha: 0,
  downsideDeviation: 0,
  periodEndAt: 0,
  periodStartAt: 0,
  exposurePct: 0,
  marketReturnPct: 0,
  netProfit: 0,
  totalReturnPct: 0,
  annualizedReturnPct: 0,
  sharpeRatio: 0,
  sortinoRatio: 0,
  volatility: 0,
  startPrice: 0,
  endPrice: 0,
  formattedDuration: '',
  annualizedNetProfit: 0,
  equityCurve: [],
  maxDrawdownPct: 0,
  longestDrawdownMs: 0,
  startEquity: 0,
  endEquity: 0,
  portfolioChangeCount: 0,
  benchmarkAsset: '', // Will be populated dynamically if possible, or empty string on fail
};

/** Default benchmark asset for portfolio analyzer */
export const DEFAULT_BENCHMARK_ASSET = 'BTC';
