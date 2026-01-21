import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Trade } from '@models/trade.types';
import { Symbol } from '@models/utility.types';
import z from 'zod';
import { exchangeSchema } from './exchange.schema';

export type ExchangeConfig = z.infer<typeof exchangeSchema>;

export interface Ticker {
  bid: number;
  ask: number;
}

export interface ExchangeDataLimits {
  candles: number;
  trades: number;
  orders: number;
}

interface MarketLimitRange {
  min?: number;
  max?: number;
}

interface MarketPrecision {
  price?: number;
  amount?: number;
}

interface MarketFee {
  maker?: number;
  taker?: number;
}

export interface MarketData {
  price?: MarketLimitRange;
  amount?: MarketLimitRange;
  cost?: MarketLimitRange;
  precision?: MarketPrecision;
  fee?: MarketFee;
}

export type FetchOHLCVParams = {
  from?: EpochTimeStamp;
  timeframe?: string;
  limit?: number;
};

export type OrderSettledCallback = (orderState: OrderState) => void;

export interface Exchange {
  fetchTicker(symbol: Symbol): Promise<Ticker>;
  fetchOHLCV(symbol: Symbol, params?: FetchOHLCVParams): Promise<Candle[]>;
  fetchMyTrades(symbol: Symbol, from?: EpochTimeStamp): Promise<Trade[]>;
  fetchBalance(): Promise<Portfolio>;
  getExchangeName(): string;
  getMarketData(symbol: Symbol): MarketData;
  createLimitOrder(
    symbol: Symbol,
    side: OrderSide,
    amount: number,
    price: number,
    onSettled?: OrderSettledCallback,
  ): Promise<OrderState>;
  createMarketOrder(symbol: Symbol, side: OrderSide, amount: number): Promise<OrderState>;
  cancelOrder(symbol: Symbol, id: string): Promise<OrderState>;
  loadMarkets(): Promise<void>;
  fetchOrder(symbol: Symbol, id: string): Promise<OrderState>;
  onNewCandle(symbol: Symbol, onNewCandle: (candle: Candle) => void): () => void;
}

export type DummyExchange = Exchange & { processOneMinuteCandle: (symbol: Symbol, candle: Candle) => void };
