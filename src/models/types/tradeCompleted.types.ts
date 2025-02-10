import { Portfolio } from './portfolio.types';

export type TradeCompleted = {
  id: number;
  adviceId: string;
  action: 'buy' | 'sell';
  cost: number;
  amount: number;
  price: number;
  portfolio: Portfolio;
  balance: number;
  date: EpochTimeStamp;
  feePercent: number;
  effectivePrice: number;
};
