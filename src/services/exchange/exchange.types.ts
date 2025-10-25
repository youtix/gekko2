import { Candle } from '@models/candle.types';
import { ExchangeConfig } from '@models/configuration.types';
import { Exchange } from './exchange';

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

export type DummyExchange = Exchange & { addCandle: (candle: Candle) => void };
