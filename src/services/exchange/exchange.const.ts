import { ExchangeDataLimits } from './exchange.types';

export const BROKER_MAX_RETRIES_ON_FAILURE = 3;
export const INTERVAL_BETWEEN_CALLS_IN_MS = 1500;

export const LIMITS: Record<string, ExchangeDataLimits> = {
  binance: { candles: 1000, trades: 1000, myTrades: 1000 },
  'dummy-dex': {},
  'dummy-cex': {},
};
