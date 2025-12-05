import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Candle } from '@models/candle.types';
import { OrderState } from '@models/order.types';
import { Trade } from '@models/trade.types';
import { error, warning } from '@services/logger';
import { getRetryDelay } from '@utils/fetch/fetch.utils';
import { wait } from '@utils/process/process.utils';
import { Order as CCXTOrder, Trade as CCXTTrade, NetworkError, OHLCV } from 'ccxt';
import { isNil } from 'lodash-es';
import { BROKER_MAX_RETRIES_ON_FAILURE } from './exchange.const';
import { DummyExchange, MarketData } from './exchange.types';

export const isDummyExchange = (exchange: unknown): exchange is DummyExchange =>
  typeof exchange === 'object' &&
  exchange &&
  'getExchangeName' in exchange &&
  typeof exchange.getExchangeName === 'function' &&
  exchange.getExchangeName().includes('dummy') &&
  'processOneMinuteCandle' in exchange &&
  typeof exchange.processOneMinuteCandle === 'function';

/** Checks if the order price is within the market data */
export const checkOrderPrice = (price: number, marketData: MarketData) => {
  const priceLimits = marketData?.price;
  const minimalPrice = priceLimits?.min;
  const maximalPrice = priceLimits?.max;

  if (isNil(minimalPrice) && isNil(maximalPrice)) return price;

  if (!isNil(minimalPrice) && price < minimalPrice)
    throw new OrderOutOfRangeError('exchange', 'price', price, minimalPrice, maximalPrice);

  if (!isNil(maximalPrice) && price > maximalPrice)
    throw new OrderOutOfRangeError('exchange', 'price', price, minimalPrice, maximalPrice);

  return price;
};

/** Checks if the order amount is within the market data */
export const checkOrderAmount = (amount: number, marketData: MarketData) => {
  const amountLimits = marketData?.amount;
  const minimalAmount = amountLimits?.min;
  const maximalAmount = amountLimits?.max;

  if (isNil(minimalAmount) && isNil(maximalAmount)) return amount;
  if (!isNil(minimalAmount) && amount < minimalAmount)
    throw new OrderOutOfRangeError('exchange', 'amount', amount, minimalAmount, maximalAmount);

  if (!isNil(maximalAmount) && amount > maximalAmount)
    throw new OrderOutOfRangeError('exchange', 'amount', amount, minimalAmount, maximalAmount);

  return amount;
};

/** Checks if the order cost is within the market data */
export const checkOrderCost = (amount: number, price: number, marketData: MarketData) => {
  const costLimits = marketData?.cost;
  const minimalCost = costLimits?.min;
  const maximalCost = costLimits?.max;

  if (isNil(minimalCost) && isNil(maximalCost)) return;

  const cost = amount * price;
  if (!isNil(minimalCost) && cost < minimalCost)
    throw new OrderOutOfRangeError('exchange', 'cost', cost, minimalCost, maximalCost);
  if (!isNil(maximalCost) && cost > maximalCost)
    throw new OrderOutOfRangeError('exchange', 'cost', cost, minimalCost, maximalCost);
};

export const retry = async <T>(
  fn: () => Promise<T>,
  currRetry = 1,
  maxRetries = BROKER_MAX_RETRIES_ON_FAILURE,
): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    const isRetryableError = err instanceof NetworkError;
    if (err instanceof Error) error('exchange', `Call to exchange failed due to ${err.message}`);
    if (!isRetryableError || currRetry > maxRetries) throw err;
    await wait(getRetryDelay(currRetry));
    warning('exchange', `Retrying to fetch (attempt ${currRetry})`);
    return retry(fn, currRetry + 1, maxRetries);
  }
};

export const mapCcxtTradeToTrade = (trade: CCXTTrade): Trade => ({
  id: trade.order ?? '',
  amount: trade.amount ?? 0,
  price: trade.price ?? 0,
  timestamp: trade.timestamp ?? Date.now(),
  fee: { rate: trade.fee?.rate ?? 0 },
});

export const mapCcxtOrderToOrder = (order: CCXTOrder): OrderState => ({
  id: order.id,
  status: processStatus(order.status),
  filled: order.filled,
  remaining: order.remaining,
  price: order.price,
  timestamp: order.timestamp,
});

export const mapOhlcvToCandles = (ohlcvList: OHLCV[]): Candle[] =>
  ohlcvList.map(ohlcv => ({
    start: ohlcv[0] ?? 0,
    open: ohlcv[1] ?? 0,
    high: ohlcv[2] ?? 0,
    low: ohlcv[3] ?? 0,
    close: ohlcv[4] ?? 0,
    volume: ohlcv[5] ?? 0,
  }));

const processStatus = (status?: string): OrderState['status'] => {
  if (!status || status === 'open') return 'open';
  if (status === 'canceled' || status === 'rejected' || status === 'expired') return 'canceled';
  return 'closed';
};
