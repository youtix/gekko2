import { UUID } from 'node:crypto';
import { Portfolio } from './portfolio.types';

export type OrderState = {
  id: string;
  status: 'open' | 'closed' | 'canceled';
  timestamp: EpochTimeStamp;
  filled?: number;
  remaining?: number;
  price?: number;
};

export type OrderType = 'MARKET' | 'STICKY';
export type OrderSide = 'SELL' | 'BUY';

export type OrderCanceled = {
  orderId: UUID;
  date: EpochTimeStamp;
  type: OrderType;
};

export type OrderErrored = OrderCanceled & {
  reason: string;
};

export type OrderInitiated = OrderCanceled & {
  side: OrderSide;
  portfolio: Portfolio;
  balance: number;
  amount: number;
};

export type OrderCompleted = OrderInitiated & {
  fee: number;
  price: number;
  effectivePrice: number;
  feePercent?: number;
};
