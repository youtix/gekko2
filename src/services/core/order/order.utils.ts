import { EMPTY_ORDER_SUMMARY } from '@constants/order.const';
import { GekkoError } from '@errors/gekko.error';
import { OrderSide, OrderType } from '@models/order.types';
import { TradingPair } from '@models/utility.types';
import { Exchange } from '@services/exchange/exchange.types';
import { debug } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { weightedMean } from '@utils/math/math.utils';
import { startOfSecond } from 'date-fns';
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

  const from = startOfSecond(transactions[0]?.timestamp).getTime();
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

  if (!trades.length || !orderExecutionDate) return { ...EMPTY_ORDER_SUMMARY, side };

  const amounts = map(trades, 'amount');
  const feePercents = trades.map(trade => trade.fee?.rate).filter((fee): fee is number => fee !== undefined && fee !== null);

  return {
    amount: sumBy(trades, 'amount'),
    price: weightedMean(map(trades, 'price'), amounts),
    feePercent: weightedMean(feePercents, amounts),
    side,
    orderExecutionDate,
  };
};
