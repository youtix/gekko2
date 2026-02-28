import { Undefined } from '@models/utility.types';
import { ExchangeDataLimits } from './exchange.types';

export const BROKER_MAX_RETRIES_ON_FAILURE = 3;

export const DUMMY_DEFAULT_BUFFER_SIZE = Number.MAX_SAFE_INTEGER;

export const PARAMS: Record<string, Record<string, Undefined<object>>> = {
  fetchTicker: { hyperliquid: { type: 'spot' } },
  fetchBalance: { hyperliquid: { type: 'spot' } },
};

export const LIMITS: Record<string, ExchangeDataLimits> = {
  binance: { candles: 1000, trades: 1000, orders: 1000 },
  hyperliquid: { candles: 5000, trades: 5000, orders: 5000 },
  'dummy-cex': {
    candles: DUMMY_DEFAULT_BUFFER_SIZE,
    trades: DUMMY_DEFAULT_BUFFER_SIZE,
    orders: DUMMY_DEFAULT_BUFFER_SIZE,
  },
  'paper-binance': { candles: 1000, trades: 1000, orders: 1000 },
};
export const BROKER_MANDATORY_FEATURES = [
  'cancelOrder',
  'createLimitOrder',
  'createMarketOrder',
  'fetchBalance',
  'fetchMyTrades',
  'fetchOHLCV',
  'fetchOrder',
  'fetchTicker',
  'fetchTickers',
];
