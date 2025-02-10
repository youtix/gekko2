import { TradeCompleted } from '@models/types/tradeCompleted.types';
import Big from 'big.js';
import { formatDuration, intervalToDuration } from 'date-fns';
import { logger } from '../../services/logger';
import { toISOString } from '../../utils/date/date.utils';
import { ROUND } from './performanceAnalyzer.const';
import { Report, RoundTrip } from './performanceAnalyzer.types';

export const logImpossibleToProcessReport = () => {
  logger.warn(
    [
      'Cannot calculate a profit report without having received portfolio data.',
      'Skipping performanceReport..',
    ].join(' '),
  );
};

export const logRoundtrip = (roundTrip: RoundTrip) => {
  // eslint-disable-next-line no-console
  console.table({
    entryDateUTC: toISOString(roundTrip.entryAt),
    exitDateUTC: toISOString(roundTrip.exitAt),
    exposedDuration: formatDuration(intervalToDuration({ start: 0, end: roundTrip.duration })),
    'P&L': roundTrip.pnl,
    'profitIn%': roundTrip.profit,
  });
  logger.info(roundTrip);
};

export const logFinalize = (report: Report, currency: string) => {
  // eslint-disable-next-line no-console
  console.table({
    label: 'PROFIT REPORT',
    startTime: toISOString(report.startTime),
    endtime: toISOString(report.endTime),
    timespan: report.timespan,
    exposure: report.exposure,
    startPrice: `${report.startPrice}${currency}`,
    endPrice: `${report.endPrice}${currency}`,
    market: `${report.market}%`,
    amountOfTrades: report.trades,
    originalBalance: +Big(report.startBalance).round(ROUND),
    currentbalance: +Big(report.balance).round(ROUND),
    simulatedYearlyProfit: `${report.yearlyProfit} ${currency} (${report.relativeYearlyProfit}%)`,
    sharpeRatio: report.sharpe,
    expectedDownside: report.downside,
    ratioRoundtrip: report.ratioRoundTrips,
  });
  logger.info(report);
};

export const logTrade = (trade: TradeCompleted, currency: string, asset: string) => {
  if (trade.action !== 'sell' && trade.action !== 'buy') return;
  logger.info(
    [
      `${toISOString(trade.date)}: Paper trader simulated a ${trade.action.toUpperCase()}`,
      `${+Big(trade.portfolio.currency).round(ROUND)}`,
      `${currency} ${trade.action === 'buy' ? '=>' : '<='} ${+Big(trade.portfolio.asset).round(ROUND)}`,
      `${asset}`,
    ].join(' '),
  );
};
