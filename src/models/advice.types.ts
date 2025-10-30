import { UUID } from 'node:crypto';
import { OrderSide, OrderType } from './order.types';

export type AdviceOrder = {
  type: OrderType;
  side: OrderSide;
  quantity?: number;
};

export type Advice = {
  id: UUID;
  date: EpochTimeStamp;
  order: AdviceOrder;
};
