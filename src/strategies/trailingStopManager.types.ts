import { TrailingConfig } from '@models/advice.types';
import { TradingPair } from '@models/utility.types';
import { UUID } from 'node:crypto';

export type TrailingStopState = {
  id: UUID;
  symbol: TradingPair;
  /**
   * The amount the BUY filled, as its ORDER_COMPLETED_EVENT reports it, an all-in BUY included: the MARKET SELL the stop sends when
   * triggered sells that amount, not the whole balance.
   */
  amount: number;
  config: TrailingConfig;
  status: 'dormant' | 'active';
  highestPeak: number;
  stopPrice: number;
  activationPrice?: number;
  createdAt: number;
};
