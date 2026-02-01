import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Trade } from '@models/trade.types';
import { TradingPair } from '@models/utility.types';
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
  fetchTickers(symbols: TradingPair[]): Promise<Record<TradingPair, Ticker>>;
  fetchTicker(symbol: TradingPair): Promise<Ticker>;
  fetchOHLCV(symbol: TradingPair, params?: FetchOHLCVParams): Promise<Candle[]>;
  fetchMyTrades(symbol: TradingPair, from?: EpochTimeStamp): Promise<Trade[]>;
  fetchBalance(): Promise<Portfolio>;
  getExchangeName(): string;
  getMarketData(symbol: TradingPair): MarketData;
  createLimitOrder(
    symbol: TradingPair,
    side: OrderSide,
    amount: number,
    price: number,
    onSettled?: OrderSettledCallback,
  ): Promise<OrderState>;
  createMarketOrder(symbol: TradingPair, side: OrderSide, amount: number): Promise<OrderState>;
  cancelOrder(symbol: TradingPair, id: string): Promise<OrderState>;
  loadMarkets(): Promise<void>;
  fetchOrder(symbol: TradingPair, id: string): Promise<OrderState>;
  onNewCandle(symbol: TradingPair, onNewCandle: (symbol: TradingPair, candle: Candle | undefined) => void): () => void;
}

export type DummyExchange = Exchange & { processOneMinuteBucket: (bucket: CandleBucket) => Promise<void> };
