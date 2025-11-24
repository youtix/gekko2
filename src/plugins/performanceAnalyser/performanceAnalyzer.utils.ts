import { OrderCompletedEvent } from '@models/event.types';
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
  order: OrderCompletedEvent['order'],
  exchange: OrderCompletedEvent['exchange'],
  currency: string,
  asset: string,
  enableConsoleTable: boolean,
  balances: TradeBalances = {},
) => {
  if (enableConsoleTable) {
    const formatter = new Intl.NumberFormat();
    const executedPrice = order.effectivePrice;
    const baselineLabel = balances.previousBalance !== undefined ? 'since last trade' : 'since start';
    const baselineForChange = balances.previousBalance ?? balances.startBalance;

    // eslint-disable-next-line no-console
    console.table({
      label: 'TRADE SNAPSHOT',
      timestamp: toISOString(order.orderExecutionDate),
      side: order.side,
      amount: `${round(order.amount, ROUND)} ${asset}`,
      price: `${formatter.format(order.price ?? 0)} ${currency}`,
      effectivePrice: `${formatter.format(executedPrice)} ${currency}`,
      volume: `${formatter.format(order.amount * executedPrice)} ${currency}`,
      balance: `${formatter.format(exchange.balance)} ${currency}`,
      portfolioChange: describePortfolioChange(baselineLabel, exchange.balance, baselineForChange, currency, formatter),
      totalSinceStart: describePortfolioChange(
        'since start',
        exchange.balance,
        balances.startBalance,
        currency,
        formatter,
      ),
      feePaid: `${formatter.format(order.fee)} ${currency}${
        typeof order.feePercent === 'number' ? ` (${round(order.feePercent, 2, 'halfEven')}%)` : ''
      }`,
    });
  }

  debug(
    'performance analyzer',
    [
      `${order.side === 'BUY' ? 'Bought' : 'Sold'}`,
      `${order.side === 'BUY' ? round(exchange.portfolio.asset, ROUND) : round(exchange.portfolio.currency, ROUND)}`,
      `${order.side === 'BUY' ? asset : currency}`,
      `at ${toISOString(order.orderCreationDate)}`,
    ].join(' '),
  );
};
