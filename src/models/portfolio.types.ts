import { Asset, TradingPair } from './utility.types';

export type BalanceDetail = {
  free: number;
  used: number;
  total: number;
};

export type Balances = Map<TradingPair, BalanceDetail>;

export type Portfolio = Map<Asset, BalanceDetail>;
