import { UUID } from 'node:crypto';
import { OrderSide, OrderType } from './order.types';
import { TradingPair } from './utility.types';

export type TrailingConfig = {
  /** The percent to trail away from the highest peak (e.g., 2.5 for 2.5%) */
  percentage: number;
  /** The price to activate the trailing monitoring */
  trigger?: number;
};

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

export type StrategyOrder = Omit<AdviceOrder, 'id' | 'orderCreationDate'> & {
  trailing?: TrailingConfig;
};
