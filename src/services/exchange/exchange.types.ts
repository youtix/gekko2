import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Trade } from '@models/trade.types';
import { TradingPair } from '@models/utility.types';
import z from 'zod';
import { exchangeSchema } from './exchange.schema';

export type ExchangeConfig = z.infer<typeof exchangeSchema>;

export type MarketValidationResult<T> = { isValid: true; value: T } | { isValid: false; reason: string; min?: number; max?: number };

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
  /**
   * The amount limits of a market order, which narrow the amount range for it (see getMarketOrderLimits): Binance's MARKET_LOT_SIZE
   * filter, which it applies to a MARKET order on top of LOT_SIZE (the amount range), with a far lower maximum on a liquid pair.
   */
  market?: MarketLimitRange;
  /**
   * The steps an order's price and amount are multiples of, 0.01 for a price to the cent, as ccxt gives them for Binance and
   * Hyperliquid (both in its TICK_SIZE precision mode). A dummy-cex configuration states numbers of decimals instead (2 for 0.01),
   * which its schema turns into these steps.
   */
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
  /**
   * Resolves with the state of the order once the exchange has accepted the cancelation, its id included: 'canceled' with the amount
   * filled until then, 'closed' if it was executed in full first, or 'open' if the exchange has not completed the cancelation yet,
   * an order still to be polled. Rejects with OrderNotFound for an order the exchange does not know, which a real exchange also
   * answers for an order already executed or canceled.
   */
  cancelOrder(symbol: TradingPair, id: string): Promise<OrderState>;
  loadMarkets(): Promise<void>;
  fetchOrder(symbol: TradingPair, id: string): Promise<OrderState>;
}

export type DummyExchange = Exchange & { processOneMinuteBucket: (bucket: CandleBucket) => Promise<void> };
