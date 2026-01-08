import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import z from 'zod';
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
  fetchTicker(): Promise<Ticker>;
  fetchOHLCV(params?: FetchOHLCVParams): Promise<Candle[]>;
  fetchMyTrades(from?: EpochTimeStamp): Promise<Trade[]>;
  fetchBalance(): Promise<Portfolio>;
  getExchangeName(): string;
  getMarketData(): MarketData;
  createLimitOrder(
    side: OrderSide,
    amount: number,
    price: number,
    onSettled?: OrderSettledCallback,
  ): Promise<OrderState>;
  createMarketOrder(side: OrderSide, amount: number): Promise<OrderState>;
  cancelOrder(id: string): Promise<OrderState>;
  loadMarkets(): Promise<void>;
  fetchOrder(id: string): Promise<OrderState>;
  onNewCandle(onNewCandle: (candle: Candle) => void): () => void;
}

export type DummyExchange = Exchange & { processOneMinuteCandle: (candle: Candle) => void };
