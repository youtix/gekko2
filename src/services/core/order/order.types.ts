import { OrderSide } from '@models/order.types';

export type OrderStatus =
  | 'canceled' // Order was succesfully canceled
  | 'error'
  | 'filled' // Order is completely filled
  | 'initializing' // Not created
  | 'open' // Order is open on the exchange
  | 'rejected'; // Order was rejected by the exchange

export type Transaction = { id: string; timestamp: EpochTimeStamp; filled?: number };
export type OrderSummary = {
  amount: number;
  price: number;
  side: OrderSide;
  feePercent?: number;
  date?: EpochTimeStamp;
};
