import { OrderSide, OrderType } from '@models/order.types';
import { Order } from '@services/core/order/order';
import { z } from 'zod';
import { traderSchema } from './trader.schema';

export type Trader = z.infer<typeof traderSchema>;

export type TraderOrderMetadata = {
  /** Order instance */
  orderInstance: Order;
  /** Order creation date */
  orderCreationDate: EpochTimeStamp;
  /** Order amount */
  amount: number;
  /** Order side (SELL | BUY)*/
  side: OrderSide;
  /** Order type ('MARKET' | 'STICKY' | 'LIMIT')*/
  type: OrderType;
  /** Order price in currency */
  price?: number;
};
