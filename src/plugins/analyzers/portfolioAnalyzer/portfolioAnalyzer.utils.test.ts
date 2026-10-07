import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
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

  let consoleTable: MockInstance<typeof console.table>;

  beforeEach(() => {
    consoleTable = vi.spyOn(console, 'table').mockImplementation(() => {});
  });

  it('should print every metric of the report', () => {
    logPortfolioReport(mockReport, 'USD');

    expect(consoleTable).toHaveBeenCalledWith({
      'Net Profit': '100.5 USD',
      'Annualized Net Profit': '0 USD',
      'Total Return %': '10.50%',
      'Annualized Return %': '0.00%',
      'Market Return %': '0.00%',
      'Max Drawdown %': '5.20%',
      Alpha: '0.0000',
      'Sharpe Ratio': '1.5000',
      'Sortino Ratio': '0.0000',
      Volatility: '0.0000',
      'Downside Deviation': '0.0000',
      'Start Equity': '0 USD',
      'End Equity': '0 USD',
      'Start Price': '0 USD',
      'End Price': '0 USD',
      Benchmark: 'BTC',
      Changes: 0,
      Duration: '',
      'Exposure %': '0.00%',
    });
  });

  // Amounts and prices keep up to 8 decimals: a price of a fraction of a cent or a profit in BTC is not printed as 0.
  it.each`
    description                                     | report                                              | field                      | expected
    ${'a start price of a fraction of a cent'}      | ${{ ...mockReport, startPrice: 0.0000012 }}         | ${'Start Price'}           | ${'0.0000012 USD'}
    ${'an end price of a fraction of a cent'}       | ${{ ...mockReport, endPrice: 0.00000012 }}          | ${'End Price'}             | ${'0.00000012 USD'}
    ${'a net profit of a fraction of a cent'}       | ${{ ...mockReport, netProfit: 0.00042 }}            | ${'Net Profit'}            | ${'0.00042 USD'}
    ${'an annualized loss of a fraction of a cent'} | ${{ ...mockReport, annualizedNetProfit: -0.00042 }} | ${'Annualized Net Profit'} | ${'-0.00042 USD'}
    ${'a start equity, its thousands grouped'}      | ${{ ...mockReport, startEquity: 1234.5678 }}        | ${'Start Equity'}          | ${'1,234.5678 USD'}
    ${'an end equity rounded to 8 decimals'}        | ${{ ...mockReport, endEquity: 0.123456789 }}        | ${'End Equity'}            | ${'0.12345679 USD'}
  `('should print $description under $field', ({ report, field, expected }) => {
    logPortfolioReport(report, 'USD');

    expect(consoleTable.mock.lastCall?.[0][field]).toBe(expected);
  });
});
