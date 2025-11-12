import { OrderSide, OrderType } from '@models/order.types';
import { Order } from '@services/core/order/order';
import { z } from 'zod';
import { traderSchema } from './trader.schema';

export type Trader = z.infer<typeof traderSchema>;

export type TraderOrderMetadata = {
  amount: number;
  side: OrderSide;
  type: OrderType;
  orderInstance: Order;
  price?: number;
};
