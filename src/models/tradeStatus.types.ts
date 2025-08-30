import { Action } from './action.types';
import { Portfolio } from './portfolio.types';

export type TradeCanceled = {
  id: string;
  adviceId: string;
  date: EpochTimeStamp;
};

export type TradeErrored = TradeCanceled & {
  reason: string;
};

export type TradeInitiated = TradeCanceled & {
  action: Action;
  portfolio: Portfolio;
  balance: number;
};

export type TradeAborted = TradeInitiated & TradeErrored;

export type TradeCompleted = TradeInitiated & {
  cost: number;
  amount: number;
  price: number;
  feePercent: number;
  effectivePrice: number;
};
