import { OrderSide, OrderState } from '@models/order.types';
import z from 'zod';
import { dummyExchangeSchema } from './dummyCentralizedExchange.schema';

export type DummyCentralizedExchangeConfig = z.infer<typeof dummyExchangeSchema>;

export type DummyInternalOrder = OrderState & {
  side: OrderSide;
  amount: number;
};
