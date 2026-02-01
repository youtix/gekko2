import { RoundTrip } from '@models/event.types';
import { info } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { round } from '@utils/math/round.utils';
import { formatRatio } from '@utils/string/string.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
import { TradingReport } from './roundTrip.types';

export const logRoundtrip = (roundTrip: RoundTrip, currency: string, enableConsoleTable: boolean) => {
  const formater = new Intl.NumberFormat();
  if (enableConsoleTable) {
    // eslint-disable-next-line no-console
    console.table({
      entryDateUTC: toISOString(roundTrip.entryAt),
      exitDateUTC: toISOString(roundTrip.exitAt),
      exposedDuration: formatDuration(intervalToDuration({ start: 0, end: roundTrip.duration })),
      'P&L': `${formater.format(roundTrip.pnl)} ${currency}`,
      profit: `${round(roundTrip.profit, 2, 'down')}%`,
      MAE: `${round(roundTrip.maxAdverseExcursion, 2, 'down')}%`,
    });
  }
  info('roundtrip analyzer', roundTrip);
};

export const logFinalize = (report: TradingReport, currency: string, enableConsoleTable: boolean) => {
  const formater = new Intl.NumberFormat();

  if (enableConsoleTable) {
    // eslint-disable-next-line no-console
    console.table({
      label: 'PROFIT REPORT',
      periodStartAt: toISOString(report.periodStartAt),
      periodEndAt: toISOString(report.periodEndAt),
      duration: report.formattedDuration,
      exposurePct: `${round(report.exposurePct, 2, 'halfEven')}% of time exposed`,
      startPrice: `${formater.format(report.startPrice)} ${currency}`,
      endPrice: `${formater.format(report.endPrice)} ${currency}`,
      marketReturnPct: `${round(report.marketReturnPct, 2, 'down')}%`,
      alpha: `${round(report.alpha, 2, 'down')}%`,
      annualizedNetProfit: `${formater.format(report.annualizedNetProfit)} ${currency} (${round(report.annualizedReturnPct, 2, 'down')}%)`,
      tradeCount: report.tradeCount,
      startBalance: `${formater.format(report.startBalance)} ${currency}`,
      finalBalance: `${formater.format(report.finalBalance)} ${currency}`,
      sharpeRatio: formatRatio(report.sharpeRatio),
      sortinoRatio: formatRatio(report.sortinoRatio),
      volatility: formatRatio(report.volatility),
      downsideDeviation: `${round(report.downsideDeviation, 2, 'down')}%`,
      winRate: report.winRate === null ? 'N/A' : `${round(report.winRate, 2)}%`,
      topMAEs: report.topMAEs.map(mae => `${round(mae, 2, 'down')}%`).join(', '),
    });
  }
  info('roundtrip analyzer', report);
};
