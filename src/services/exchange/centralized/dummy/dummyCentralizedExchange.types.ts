import { Action } from '@models/action.types';
import { OrderState } from '@models/order.types';
import z from 'zod';
import { dummyExchangeSchema } from './dummyCentralizedExchange.schema';

export type DummyCentralizedExchangeConfig = z.infer<typeof dummyExchangeSchema>;

export type DummyOrderSide = Action;

export type DummyInternalOrder = OrderState & {
  side: DummyOrderSide;
  amount: number;
};
