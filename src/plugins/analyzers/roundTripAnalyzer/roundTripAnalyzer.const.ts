import { TradingReport } from './roundTrip.types';

/** Plugin name constant to avoid minification issues with class.name */
export const PLUGIN_NAME = 'PerformanceAnalyzer';

/** Empty trading report for zero-trade scenarios */
export const EMPTY_TRADING_REPORT: TradingReport = {
  id: 'TRADING REPORT',
  alpha: 0,
  downsideDeviation: 0,
  periodEndAt: 0,
  periodStartAt: 0,
  exposurePct: 0,
  finalBalance: 0,
  marketReturnPct: 0,
  netProfit: 0,
  totalReturnPct: 0,
  annualizedReturnPct: 0,
  sharpeRatio: 0,
  sortinoRatio: 0,
  volatility: 0,
  startBalance: 0,
  startPrice: 0,
  endPrice: 0,
  formattedDuration: '',
  annualizedNetProfit: 0,
  winRate: null,
  topMAEs: [],
  tradeCount: 0,
};
