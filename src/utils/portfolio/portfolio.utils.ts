import type { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { Asset, TradingPair } from '@models/utility.types';
import { uniq } from 'lodash-es';

export const ZERO_BALANCE: BalanceDetail = { free: 0, used: 0, total: 0 };

export const createEmptyPortfolio = (): Portfolio => new Map();

export const initializePortfolio = (pairs: TradingPair[], initialAmounts?: Map<Asset, number>): Portfolio => {
  const assets = uniq(pairs.flatMap(pair => pair.split('/')));
  return new Map(
    assets.map(asset => [
      asset,
      {
        free: initialAmounts?.get(asset) ?? 0,
        used: 0,
        total: initialAmounts?.get(asset) ?? 0,
      },
    ]),
  );
};

export const getAssetBalance = (portfolio: Portfolio, asset: Asset): BalanceDetail => {
  return portfolio.get(asset) ?? { ...ZERO_BALANCE };
};

export const updateAssetBalance = (portfolio: Portfolio, asset: Asset, balance: BalanceDetail): void => {
  portfolio.set(asset, balance);
};

export const isPortfolioEmpty = (portfolio: Portfolio): boolean => {
  for (const balance of portfolio.values()) {
    if (balance.total > 0) return false;
  }
  return true;
};

/**
 * Calculate the equity of a trading pair.
 * Equity = (Asset Total * Price) + Currency Total
 */
export const calculatePairEquity = (portfolio: Portfolio, pair: TradingPair, price: number): BalanceDetail => {
  const [asset, currency] = pair.split('/');
  const assetBalance = getAssetBalance(portfolio, asset);
  const currencyBalance = getAssetBalance(portfolio, currency);

  return {
    free: assetBalance.free * price + currencyBalance.free,
    used: assetBalance.used * price + currencyBalance.used,
    total: assetBalance.total * price + currencyBalance.total,
  };
};
