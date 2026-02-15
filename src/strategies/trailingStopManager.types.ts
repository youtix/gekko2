import { TrailingConfig } from '@models/advice.types';
import { OrderSide } from '@models/order.types';
import { TradingPair } from '@models/utility.types';
import { UUID } from 'node:crypto';

export type TrailingStopState = {
  id: UUID;
  symbol: TradingPair;
  side: OrderSide;
  amount: number;
  config: TrailingConfig;
  status: 'dormant' | 'active';
  highestPeak: number;
  stopPrice: number;
  activationPrice: number;
  createdAt: number;
};
