import type { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { Asset, TradingPair } from '@models/utility.types';
import { uniq } from 'lodash-es';

export const EMPTY_BALANCE: BalanceDetail = { free: 0, used: 0, total: 0 };

export const createEmptyPortfolio = (): Portfolio => new Map();

export const createPortfolio = (pairs: TradingPair[], initialBalance?: Map<Asset, number>): Portfolio => {
  const assets = uniq(pairs.flatMap(pair => pair.split('/')));
  return new Map(
    assets.map(asset => [
      asset,
      {
        free: initialBalance?.get(asset) ?? 0,
        used: 0,
        total: initialBalance?.get(asset) ?? 0,
      },
    ]),
  );
};

export const getBalance = (portfolio: Portfolio, symbol: string): BalanceDetail => {
  return portfolio.get(symbol) ?? { ...EMPTY_BALANCE };
};

export const setBalance = (portfolio: Portfolio, symbol: string, balance: BalanceDetail): void => {
  portfolio.set(symbol, balance);
};

export const clonePortfolio = (portfolio: Portfolio): Portfolio => {
  const cloned = new Map<string, BalanceDetail>();
  for (const [symbol, balance] of portfolio) {
    cloned.set(symbol, { ...balance });
  }
  return cloned;
};

export const isEmptyPortfolio = (portfolio: Portfolio): boolean => {
  for (const balance of portfolio.values()) {
    if (balance.total > 0) return false;
  }
  return true;
};
