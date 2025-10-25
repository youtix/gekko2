import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { ExchangeDataLimits, MarketLimits } from './exchange.types';

export const BROKER_MAX_RETRIES_ON_FAILURE = 3;
export const INTERVAL_BETWEEN_CALLS_IN_MS = 1500;

export const DUMMY_DEFAULT_LIMITS: Required<MarketLimits> = {
  price: { min: 1, max: 1_000_000 },
  amount: { min: 0.0001, max: 1_000 },
  cost: { min: 10, max: 1_000_000 },
};

export const DUMMY_DEFAULT_PORTFOLIO: Portfolio = {
  asset: 0,
  currency: 100_000,
};

export const DUMMY_DEFAULT_TICKER: Ticker = { bid: 100, ask: 101 };
export const DUMMY_DEFAULT_BUFFER_SIZE = Number.MAX_SAFE_INTEGER;

export const LIMITS: Record<string, ExchangeDataLimits> = {
  binance: { candles: 1000, trades: 1000, orders: 1000 },
  'dummy-cex': {
    candles: DUMMY_DEFAULT_BUFFER_SIZE,
    trades: DUMMY_DEFAULT_BUFFER_SIZE,
    orders: DUMMY_DEFAULT_BUFFER_SIZE,
  },
};
