import { UUID } from 'node:crypto';
import { OrderSide, OrderType } from './order.types';
import { TradingPair } from './utility.types';

export type AdviceOrder = {
  /** Trading Pair */
  symbol: TradingPair;
  /** Gekko order id */
  id: UUID;
  /** Order creation date */
  orderCreationDate: EpochTimeStamp;
  /** Order side */
  side: OrderSide;
  /** Order type */
  type: OrderType;
  /** Order amount */
  amount?: number;
  /** Order price */
  price?: number;
};
