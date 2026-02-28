import { PortfolioReport } from './portfolioAnalyzer.types';

export const logPortfolioReport = (report: PortfolioReport, currency: string): void => {
  // eslint-disable-next-line no-console
  console.table({
    'Net Profit': `${report.netProfit.toFixed(2)} ${currency}`,
    'Annualized Net Profit': `${report.annualizedNetProfit.toFixed(2)} ${currency}`,
    'Total Return %': report.totalReturnPct.toFixed(2) + '%',
    'Annualized Return %': report.annualizedReturnPct.toFixed(2) + '%',
    'Market Return %': report.marketReturnPct.toFixed(2) + '%',
    'Max Drawdown %': report.maxDrawdownPct.toFixed(2) + '%',
    Alpha: report.alpha.toFixed(4),
    'Sharpe Ratio': report.sharpeRatio.toFixed(4),
    'Sortino Ratio': report.sortinoRatio.toFixed(4),
    Volatility: report.volatility.toFixed(4),
    'Downside Deviation': report.downsideDeviation.toFixed(4),
    'Start Equity': `${report.startEquity.toFixed(2)} ${currency}`,
    'End Equity': `${report.endEquity.toFixed(2)} ${currency}`,
    'Start Price': `${report.startPrice.toFixed(4)} ${currency}`,
    'End Price': `${report.endPrice.toFixed(4)} ${currency}`,
    Benchmark: report.benchmarkAsset,
    Changes: report.portfolioChangeCount,
    Duration: report.formattedDuration,
    'Exposure %': report.exposurePct.toFixed(2) + '%',
  });
};
