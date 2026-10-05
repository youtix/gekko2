import { EMPTY_ORDER_SUMMARY } from '@constants/order.const';
import { GekkoError } from '@errors/gekko.error';
import { OrderSide, OrderType } from '@models/order.types';
import { Trade } from '@models/trade.types';
import { TradingPair } from '@models/utility.types';
import { Exchange } from '@services/exchange/exchange.types';
import { debug } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { weightedMean } from '@utils/math/math.utils';
import { startOfSecond } from 'date-fns';
import { filter, isNil, last, map, min, sortBy, sumBy } from 'lodash-es';
import { UUID } from 'node:crypto';
import { OrderSummary, Transaction } from './order.types';

/**
 * A failure as an Error. Nobody awaits launch(), cancel() or checkOrder() (the Trader floats them, an interval runs checkOrder),
 * so an order reports a failure through orderErrored and never throws. A non-Error value is wrapped rather than dropped, so that
 * the order still ends with ORDER_ERRORED_EVENT.
 */
export const toError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

type CreateOrderSummaryParams = {
  id: UUID;
  symbol: TradingPair;
  exchange: Exchange;
  type: OrderType;
  side: OrderSide;
  transactions: Transaction[];
};

/**
 * The bound the trades of an order are fetched from: the start of the second of its oldest transaction, which is not always the
 * first one listed (a timestamp may be the last update of the exchange order, or the time its state was read). Only finite
 * timestamps count. Without any, undefined: the exchange then returns its latest trades, where a NaN bound found none.
 */
const getTradesStart = (transactions: Transaction[]) => {
  const oldestTimestamp = min(filter(map(transactions, 'timestamp'), timestamp => Number.isFinite(timestamp)));
  return isNil(oldestTimestamp) ? undefined : startOfSecond(oldestTimestamp).getTime();
};

type RatedTrade = Trade & { fee: { rate: number } };

/**
 * The fee rate of an order, in %: the mean of the rates of its trades, each weighted by its own amount, over the trades whose rate
 * is known (a finite number; 0 is a trade without fees). Undefined, for unknown, when no rate is known or their trades weigh nothing.
 */
const getFeePercent = (trades: Trade[]) => {
  const ratedTrades = trades.filter((trade): trade is RatedTrade => Number.isFinite(trade.fee?.rate));
  const feePercent = weightedMean(
    ratedTrades.map(({ fee }) => fee.rate),
    map(ratedTrades, 'amount'),
  );
  return Number.isFinite(feePercent) ? feePercent : undefined;
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

  const from = getTradesStart(transactions);
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

  return {
    amount: sumBy(trades, 'amount'),
    price: weightedMean(map(trades, 'price'), map(trades, 'amount')),
    feePercent: getFeePercent(trades),
    side,
    orderExecutionDate,
  };
};
