import { RoundTrip } from '@models/types/roundtrip.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { debug, info } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import Big from 'big.js';
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
      profit: `${+Big(roundTrip.profit).round(2, Big.roundDown)}%`,
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
      exposure: `${+Big(report.exposure).round(2, Big.roundHalfEven)}% of time exposed`,
      startPrice: `${formater.format(report.startPrice)} ${currency}`,
      endPrice: `${formater.format(report.endPrice)} ${currency}`,
      market: `${+Big(report.market).round(2, Big.roundDown)}%`,
      alpha: `${+Big(report.alpha).round(2, Big.roundDown)}%`,
      simulatedYearlyProfit: `${formater.format(report.yearlyProfit)} ${currency} (${+Big(report.relativeYearlyProfit).round(2, Big.roundDown)}%)`,
      amountOfTrades: report.trades,
      originalBalance: `${formater.format(report.startBalance)} ${currency}`,
      currentbalance: `${formater.format(report.balance)} ${currency}`,
      sharpeRatio: report.sharpe,
      expectedDownside: `${+Big(report.downside).round(2, Big.roundDown)}%`,
      ratioRoundtrip: `${+Big(report.ratioRoundTrips).round(2, Big.roundDown)}%`,
    });
  }
  info('performance analyzer', report);
};

export const logTrade = (trade: TradeCompleted, currency: string, asset: string) => {
  if (trade.action !== 'sell' && trade.action !== 'buy') return;
  debug(
    'performance analyzer',
    [
      `${trade.action === 'buy' ? 'Bought' : 'Sold'}`,
      `${trade.action === 'buy' ? +Big(trade.portfolio.asset).round(ROUND) : +Big(trade.portfolio.currency).round(ROUND)}`,
      `${trade.action === 'buy' ? asset : currency}`,
      `at ${toISOString(trade.date)}`,
    ].join(' '),
  );
};
