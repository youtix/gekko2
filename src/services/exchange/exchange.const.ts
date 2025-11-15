import { ExchangeDataLimits } from './exchange.types';

export const BROKER_MAX_RETRIES_ON_FAILURE = 3;

export const DUMMY_DEFAULT_BUFFER_SIZE = Number.MAX_SAFE_INTEGER;

export const LIMITS: Record<string, ExchangeDataLimits> = {
  binance: { candles: 1000, trades: 1000, orders: 1000 },
  'dummy-cex': {
    candles: DUMMY_DEFAULT_BUFFER_SIZE,
    trades: DUMMY_DEFAULT_BUFFER_SIZE,
    orders: DUMMY_DEFAULT_BUFFER_SIZE,
  },
};
