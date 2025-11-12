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

export type OrderType = 'MARKET' | 'STICKY' | 'LIMIT';
export type OrderSide = 'SELL' | 'BUY';

type OrderLifecycleEvent = {
  orderId: UUID;
  date: EpochTimeStamp;
  type: OrderType;
  side: OrderSide;
  amount: number;
  price?: number;
};

export type OrderCanceled = OrderLifecycleEvent & {
  filled: number;
  remaining: number;
};

export type OrderErrored = OrderLifecycleEvent & {
  reason: string;
};

export type OrderInitiated = OrderLifecycleEvent & {
  portfolio: Portfolio;
  balance: number;
};

export type OrderCompleted = OrderInitiated & {
  effectivePrice: number;
  fee: number;
  feePercent?: number;
  price: number;
};
