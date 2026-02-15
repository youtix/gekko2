import { describe, expect, it, vi } from 'vitest';
import { PortfolioReport } from './portfolioAnalyzer.types';
import { logPortfolioReport } from './portfolioAnalyzer.utils';

describe('logPortfolioReport', () => {
  const mockReport: PortfolioReport = {
    id: 'PORTFOLIO PROFIT REPORT',
    netProfit: 100.5,
    totalReturnPct: 10.5,
    maxDrawdownPct: 5.2,
    sharpeRatio: 1.5,
    alpha: 0,
    downsideDeviation: 0,
    periodEndAt: 0,
    periodStartAt: 0,
    exposurePct: 0,
    marketReturnPct: 0,
    annualizedReturnPct: 0,
    sortinoRatio: 0,
    volatility: 0,
    startPrice: 0,
    endPrice: 0,
    formattedDuration: '',
    annualizedNetProfit: 0,
    equityCurve: [],
    longestDrawdownMs: 0,
    startEquity: 0,
    endEquity: 0,
    portfolioChangeCount: 0,
    benchmarkAsset: 'BTC',
  };

  it('should log table when enabled', () => {
    const consoleTableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

    logPortfolioReport(mockReport, 'USD');

    expect(consoleTableSpy).toHaveBeenCalledWith({
      'Net Profit': '100.50 USD',
      'Annualized Net Profit': '0.00 USD',
      'Total Return %': '10.50%',
      'Annualized Return %': '0.00%',
      'Market Return %': '0.00%',
      'Max Drawdown %': '5.20%',
      Alpha: '0.0000',
      'Sharpe Ratio': '1.5000',
      'Sortino Ratio': '0.0000',
      Volatility: '0.0000',
      'Downside Deviation': '0.0000',
      'Start Equity': '0.00 USD',
      'End Equity': '0.00 USD',
      'Start Price': '0.0000 USD',
      'End Price': '0.0000 USD',
      Benchmark: 'BTC',
      Changes: 0,
      Duration: '',
      'Exposure %': '0.00%',
    });
  });
});
