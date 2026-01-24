import { UUID } from 'node:crypto';
import { Candle } from './candle.types';
import { OrderSide, OrderType } from './order.types';
import { BalanceDetail, Portfolio } from './portfolio.types';
import { TradingPair } from './utility.types';

export type CandleEvent = {
  /** Trading pair symbol in CCXT format (e.g., "BTC/USDT") */
  symbol: TradingPair;
  /** The candle data for this symbol, can be undefined when no new candle is available (exchange maintenance) */
  candle: Candle | undefined;
};
export type SecuredCandleEvent = CandleEvent & {
  candle: Candle;
};

/**
 * Represents a synchronized batch of candles keyed by trading pair.
 * Used for multi-asset pipeline routing where all candles share the same timestamp.
 * Trading pair should be in CCXT format: "BTC/USDT", "ETH/USDT", etc.
 */
export type CandleBucket = Record<TradingPair, Candle>;

export interface BalanceSnapshot {
  date: number;
  balance: BalanceDetail;
}

export type DeffferedEvent = {
  name: string;
  payload: unknown;
};

type OrderEvent = {
  /** Order Id */
  id: UUID;
  /** Order side (SELL | BUY)*/
  side: OrderSide;
  /** Order type ('MARKET' | 'STICKY' | 'LIMIT')*/
  type: OrderType;
  /** Order amount */
  amount: number;
  /** Order price in currency */
  price?: number;
};

export type ExchangeEvent = {
  /** Current portfolio value */
  portfolio: Portfolio;
  /** Current balance value */
  balance: BalanceDetail;
  /** Current price of the asset in currencey */
  price: number;
};

export type OrderInitiatedEvent = {
  order: OrderEvent & {
    /** Order Creation date */
    orderCreationDate: EpochTimeStamp;
  };
  exchange: ExchangeEvent;
};

export type OrderCanceledEvent = OrderInitiatedEvent & {
  order: OrderEvent & {
    /** Order Cancelation date */
    orderCancelationDate: EpochTimeStamp;
    /** Order filled amount */
    filled: number;
    /** Order remaining amount */
    remaining: number;
  };
};

export type OrderErroredEvent = OrderInitiatedEvent & {
  order: OrderEvent & {
    /** Order error reason */
    reason: string;
    /** Order error date */
    orderErrorDate: EpochTimeStamp;
  };
};

export type OrderCompletedEvent = OrderInitiatedEvent & {
  order: OrderEvent & {
    /** Order Execution date */
    orderExecutionDate: EpochTimeStamp;
    effectivePrice: number;
    /** Order fee */
    fee: number;
    /** Order fee percentage */
    feePercent?: number;
  };
};
