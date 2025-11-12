import { UUID } from 'node:crypto';
import { OrderSide, OrderType } from './order.types';

export type AdviceOrder = {
  side: OrderSide;
  type: OrderType;
  quantity?: number;
  price?: number;
};

export type Advice = {
  id: UUID;
  date: EpochTimeStamp;
  order: AdviceOrder;
};
