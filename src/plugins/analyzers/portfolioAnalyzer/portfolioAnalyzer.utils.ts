import { formatAmount } from '@utils/string/string.utils';
import { PortfolioReport } from './portfolioAnalyzer.types';

export const logPortfolioReport = (report: PortfolioReport, currency: string): void => {
  // eslint-disable-next-line no-console
  console.table({
    'Net Profit': `${formatAmount(report.netProfit)} ${currency}`,
    'Annualized Net Profit': `${formatAmount(report.annualizedNetProfit)} ${currency}`,
    'Total Return %': report.totalReturnPct.toFixed(2) + '%',
    'Annualized Return %': report.annualizedReturnPct.toFixed(2) + '%',
    'Market Return %': report.marketReturnPct.toFixed(2) + '%',
    'Max Drawdown %': report.maxDrawdownPct.toFixed(2) + '%',
    Alpha: report.alpha.toFixed(4),
    'Sharpe Ratio': report.sharpeRatio.toFixed(4),
    'Sortino Ratio': report.sortinoRatio.toFixed(4),
    Volatility: report.volatility.toFixed(4),
    'Downside Deviation': report.downsideDeviation.toFixed(4),
    'Start Equity': `${formatAmount(report.startEquity)} ${currency}`,
    'End Equity': `${formatAmount(report.endEquity)} ${currency}`,
    'Start Price': `${formatAmount(report.startPrice)} ${currency}`,
    'End Price': `${formatAmount(report.endPrice)} ${currency}`,
    Benchmark: report.benchmarkAsset,
    Changes: report.portfolioChangeCount,
    Duration: report.formattedDuration,
    'Exposure %': report.exposurePct.toFixed(2) + '%',
  });
};
