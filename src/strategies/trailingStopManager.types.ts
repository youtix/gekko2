import { TrailingConfig } from '@models/advice.types';
import { TradingPair } from '@models/utility.types';
import { UUID } from 'node:crypto';

export type TrailingStopState = {
  id: UUID;
  symbol: TradingPair;
  amount: number | undefined;
  config: TrailingConfig;
  status: 'dormant' | 'active';
  highestPeak: number;
  stopPrice: number;
  activationPrice?: number;
  createdAt: number;
};
