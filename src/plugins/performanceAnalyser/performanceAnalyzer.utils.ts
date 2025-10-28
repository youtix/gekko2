import { RoundTrip } from '@models/roundtrip.types';
import { TradeCompleted } from '@models/tradeStatus.types';
import { debug, info } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { round } from '@utils/math/round.utils';
import { formatPercentageList, formatRatio } from '@utils/string/string.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
import { ROUND } from './performanceAnalyzer.const';
import { Report } from './performanceAnalyzer.types';

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
  info('performance analyzer', roundTrip);
};

export const logFinalize = (report: Report, currency: string, enableConsoleTable: boolean) => {
  const formater = new Intl.NumberFormat();

  if (enableConsoleTable) {
    // eslint-disable-next-line no-console
    console.table({
      label: 'PROFIT REPORT',
      startTime: toISOString(report.startTime),
      endtime: toISOString(report.endTime),
      duration: report.duration,
      exposure: `${round(report.exposure, 2, 'halfEven')}% of time exposed`,
      startPrice: `${formater.format(report.startPrice)} ${currency}`,
      endPrice: `${formater.format(report.endPrice)} ${currency}`,
      market: `${round(report.market, 2, 'down')}%`,
      alpha: `${round(report.alpha, 2, 'down')}%`,
      simulatedYearlyProfit: `${formater.format(report.yearlyProfit)} ${currency} (${round(report.relativeYearlyProfit, 2, 'down')}%)`,
      amountOfTrades: report.trades,
      originalBalance: `${formater.format(report.startBalance)} ${currency}`,
      currentbalance: `${formater.format(report.balance)} ${currency}`,
      sharpeRatio: formatRatio(report.sharpe),
      sortinoRatio: formatRatio(report.sortino),
      standardDeviation: formatRatio(report.standardDeviation),
      expectedDownside: `${round(report.downside, 2, 'down')}%`,
      ratioRoundtrip: report.ratioRoundTrips === null ? 'N/A' : `${round(report.ratioRoundTrips, 2)}%`,
      topMAEList: formatPercentageList(report.topMaxAdverseExcursions),
    });
  }
  info('performance analyzer', report);
};

export const logTrade = (trade: TradeCompleted, currency: string, asset: string) => {
  debug(
    'performance analyzer',
    [
      `${trade.action === 'BUY' ? 'Bought' : 'Sold'}`,
      `${trade.action === 'BUY' ? round(trade.portfolio.asset, ROUND) : round(trade.portfolio.currency, ROUND)}`,
      `${trade.action === 'BUY' ? asset : currency}`,
      `at ${toISOString(trade.date)}`,
    ].join(' '),
  );
};
