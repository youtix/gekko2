import type { BalanceDetail, Portfolio } from '@models/portfolio.types';

const EMPTY_BALANCE: BalanceDetail = { free: 0, used: 0, total: 0 };

export const createEmptyPortfolio = (): Portfolio => new Map();

export const createPortfolio = (
  asset: string,
  assetBalance: BalanceDetail,
  currency: string,
  currencyBalance: BalanceDetail,
): Portfolio => {
  const portfolio = new Map<string, BalanceDetail>();
  portfolio.set(asset, assetBalance);
  portfolio.set(currency, currencyBalance);
  return portfolio;
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
