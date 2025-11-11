import { OrderCompleted } from '@models/order.types';
import { debug, info } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { round } from '@utils/math/round.utils';
import { formatRatio, formatSignedAmount, formatSignedPercent } from '@utils/string/string.utils';
import { ROUND } from './performanceAnalyzer.const';
import { Report, TradeBalances } from './performanceAnalyzer.types';

const describePortfolioChange = (
  label: string,
  currentBalance: number,
  baselineBalance: number | undefined,
  currency: string,
  formatter: Intl.NumberFormat,
) => {
  if (baselineBalance === undefined || Number.isNaN(baselineBalance)) return `${label}: n/a`;
  const absoluteChange = currentBalance - baselineBalance;
  if (!Number.isFinite(absoluteChange)) return `${label}: n/a`;

  const absoluteLabel = formatSignedAmount(absoluteChange, currency, formatter);
  const percentChange = baselineBalance === 0 ? 'n/a' : formatSignedPercent((absoluteChange / baselineBalance) * 100);

  return `${label}: ${absoluteLabel} (${percentChange})`;
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
      amountOfOrders: report.orders,
      originalBalance: `${formater.format(report.startBalance)} ${currency}`,
      currentbalance: `${formater.format(report.balance)} ${currency}`,
      sharpeRatio: formatRatio(report.sharpe),
      sortinoRatio: formatRatio(report.sortino),
      standardDeviation: formatRatio(report.standardDeviation),
      expectedDownside: `${round(report.downside, 2, 'down')}%`,
    });
  }
  info('performance analyzer', report);
};

export const logTrade = (
  trade: OrderCompleted,
  currency: string,
  asset: string,
  enableConsoleTable: boolean,
  balances: TradeBalances = {},
) => {
  if (enableConsoleTable) {
    const formatter = new Intl.NumberFormat();
    const executedPrice = trade.effectivePrice ?? trade.price;
    const baselineLabel = balances.previousBalance !== undefined ? 'since last trade' : 'since start';
    const baselineForChange = balances.previousBalance ?? balances.startBalance;

    // eslint-disable-next-line no-console
    console.table({
      label: 'TRADE SNAPSHOT',
      timestamp: toISOString(trade.date),
      side: trade.side,
      amount: `${round(trade.amount, ROUND)} ${asset}`,
      price: `${formatter.format(trade.price)} ${currency}`,
      effectivePrice: `${formatter.format(executedPrice)} ${currency}`,
      volume: `${formatter.format(trade.amount * executedPrice)} ${currency}`,
      balance: `${formatter.format(trade.balance)} ${currency}`,
      portfolioChange: describePortfolioChange(baselineLabel, trade.balance, baselineForChange, currency, formatter),
      totalSinceStart: describePortfolioChange(
        'since start',
        trade.balance,
        balances.startBalance,
        currency,
        formatter,
      ),
      feePaid: `${formatter.format(trade.fee)} ${currency}${
        typeof trade.feePercent === 'number' ? ` (${round(trade.feePercent, 2, 'halfEven')}%)` : ''
      }`,
    });
  }

  debug(
    'performance analyzer',
    [
      `${trade.side === 'BUY' ? 'Bought' : 'Sold'}`,
      `${trade.side === 'BUY' ? round(trade.portfolio.asset, ROUND) : round(trade.portfolio.currency, ROUND)}`,
      `${trade.side === 'BUY' ? asset : currency}`,
      `at ${toISOString(trade.date)}`,
    ].join(' '),
  );
};
