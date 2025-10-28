import { GekkoError } from '@errors/gekko.error';
import { Action } from '@models/action.types';
import { OrderType } from '@models/order.types';
import { Exchange } from '@services/exchange/exchange';
import { debug } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { weightedMean } from '@utils/math/math.utils';
import { filter, last, map, sortBy, sumBy } from 'lodash-es';
import { Transaction } from './order.types';

type CreateOrderSummaryParams = {
  exchange: Exchange;
  label: OrderType;
  side: Action;
  transactions: Transaction[];
};

export async function createOrderSummary({ exchange, label, side, transactions }: CreateOrderSummaryParams) {
  if (!transactions.length) throw new GekkoError('core', 'Order is not completed');

  const from = resetDateParts(transactions[0]?.timestamp, ['ms']);
  const myTrades = await exchange.fetchMyTrades(from);
  const orderIDs = map(transactions, 'id');
  const trades = sortBy(
    filter(myTrades, trade => orderIDs.includes(trade.id)),
    'timestamp',
  );

  debug(
    'core',
    [`${myTrades.length} trades used to fill ${label} order.`, `First trade started at: ${toISOString(from)}.`].join(
      ' ',
    ),
  );

  if (!trades.length) throw new GekkoError('core', 'No trades found in order');

  const amounts = map(trades, 'amount');
  const feePercents = trades
    .map(trade => trade.fee?.rate)
    .filter((fee): fee is number => fee !== undefined && fee !== null);

  return {
    amount: sumBy(trades, 'amount'),
    price: weightedMean(map(trades, 'price'), amounts),
    feePercent: feePercents.length ? weightedMean(feePercents, amounts) : undefined,
    side,
    date: last(trades)?.timestamp,
  };
}
