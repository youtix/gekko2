import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { MarketLimits } from '../../exchange';

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
