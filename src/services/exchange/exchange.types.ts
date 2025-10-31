import { Candle } from '@models/candle.types';
import z from 'zod';
import { Exchange } from './exchange';
import { exchangeSchema } from './exchange.schema';

export type ExchangeConfig = z.infer<typeof exchangeSchema>;

export interface ExchangeDataLimits {
  candles: number;
  trades: number;
  orders: number;
}

interface MarketLimitRange {
  min?: number;
  max?: number;
}

export interface MarketLimits {
  price?: MarketLimitRange;
  amount?: MarketLimitRange;
  cost?: MarketLimitRange;
}

export type DummyExchange = Exchange & { addCandle: (candle: Candle) => void };
