import { ExchangeConfig } from '@models/configuration.types';

export type ExchangeNames = ExchangeConfig['name'];

export interface ExchangeDataLimits {
  candles: number;
  trades: number;
  orders: number;
}
export interface MarketLimitRange {
  min?: number;
  max?: number;
}

export interface MarketLimits {
  price?: MarketLimitRange;
  amount?: MarketLimitRange;
  cost?: MarketLimitRange;
}
