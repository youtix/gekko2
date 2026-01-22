import { GekkoError } from '@errors/gekko.error';
import { OrderSide, OrderType } from '@models/order.types';
import { TradingPair } from '@models/utility.types';
import { Exchange } from '@services/exchange/exchange.types';
import { debug } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { weightedMean } from '@utils/math/math.utils';
import { filter, last, map, sortBy, sumBy } from 'lodash-es';
import { UUID } from 'node:crypto';
import { OrderSummary, Transaction } from './order.types';

type CreateOrderSummaryParams = {
  id: UUID;
  symbol: TradingPair;
  exchange: Exchange;
  type: OrderType;
  side: OrderSide;
  transactions: Transaction[];
};

export const createOrderSummary = async ({
  id,
  symbol,
  exchange,
  type,
  side,
  transactions,
}: CreateOrderSummaryParams): Promise<OrderSummary> => {
  if (!transactions.length) throw new GekkoError('core', `[${id}] Order is not completed`);

  const from = resetDateParts(transactions[0]?.timestamp, ['ms']);
  const myTrades = await exchange.fetchMyTrades(symbol, from);
  const orderIDs = map(transactions, 'id');
  const trades = sortBy(
    filter(myTrades, trade => orderIDs.includes(trade.id)),
    'timestamp',
  );
  const orderExecutionDate = last(trades)?.timestamp;

  debug(
    'core',
    [`[${id}] ${trades.length} trades used to fill ${side} ${type} order.`, `First trade started at: ${toISOString(from)}.`].join(' '),
  );

  if (!trades.length || !orderExecutionDate) throw new GekkoError('core', `[${id}] No trades found in order`);

  const amounts = map(trades, 'amount');
  const feePercents = trades.map(trade => trade.fee?.rate).filter((fee): fee is number => fee !== undefined && fee !== null);

  return {
    amount: sumBy(trades, 'amount'),
    price: weightedMean(map(trades, 'price'), amounts),
    feePercent: feePercents.length ? weightedMean(feePercents, amounts) : undefined,
    side,
    orderExecutionDate,
  };
};
