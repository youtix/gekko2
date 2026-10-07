import { UUID } from 'node:crypto';
import { OrderSide, OrderType } from './order.types';
import { TradingPair } from './utility.types';

export type TrailingConfig = {
  /** The percent to trail away from the highest peak, above 0 and below 100 (e.g., 2.5 for 2.5%); anything else is refused at arming */
  percentage: number;
  /** The price that activates the trailing monitoring, above 0; leave it out for a stop active as soon as it is armed */
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
