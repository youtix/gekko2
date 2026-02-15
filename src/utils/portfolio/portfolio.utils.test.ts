import { describe, expect, it } from 'vitest';

import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { Asset, TradingPair } from '@models/utility.types';
import {
  calculatePortfolioTotalValue,
  getAssetBalance,
  initializePortfolio,
  isPortfolioEmpty,
  updateAssetBalance,
  ZERO_BALANCE,
} from './portfolio.utils';

// ─────────────────────────────────────────────────────────────────────────────
// Test Data Factories
// ─────────────────────────────────────────────────────────────────────────────

const createBalanceDetail = (free = 0, used = 0, total = 0): BalanceDetail => ({ free, used, total });

// ─────────────────────────────────────────────────────────────────────────────
// initializePortfolio
// ─────────────────────────────────────────────────────────────────────────────

describe('initializePortfolio', () => {
  it('returns a Map instance', () => {
    expect(initializePortfolio([])).toBeInstanceOf(Map);
  });

  it('initially has size 0 when no pairs are provided', () => {
    expect(initializePortfolio([]).size).toBe(0);
  });

  it('creates a portfolio with correct size for a single pair', () => {
    const pairs: `${string}/${string}`[] = ['ETH/EUR'];
    expect(initializePortfolio(pairs).size).toBe(2);
  });

  it('creates unique entries from multiple pairs sharing assets', () => {
    const pairs: `${string}/${string}`[] = ['BTC/USDT', 'ETH/USDT'];
    // BTC, USDT, ETH -> 3 unique assets
    expect(initializePortfolio(pairs).size).toBe(3);
  });

  it.each([
    {
      description: 'initializes with 0 balance by default',
      pairs: ['BTC/USDT'],
      initialAmounts: undefined,
      assetToCheck: 'BTC',
      expectedTotal: 0,
    },
    {
      description: 'initializes with provided balance for asset',
      pairs: ['BTC/USDT'],
      initialAmounts: new Map([['BTC', 5]]),
      assetToCheck: 'BTC',
      expectedTotal: 5,
    },
    {
      description: 'initializes with provided balance for currency',
      pairs: ['BTC/USDT'],
      initialAmounts: new Map([['USDT', 100]]),
      assetToCheck: 'USDT',
      expectedTotal: 100,
    },
    {
      description: 'initializes with 0 if asset not in initial amounts',
      pairs: ['BTC/USDT'],
      initialAmounts: new Map([['ETH', 10]]),
      assetToCheck: 'BTC',
      expectedTotal: 0,
    },
  ])('$description', ({ pairs, initialAmounts, assetToCheck, expectedTotal }) => {
    const portfolio = initializePortfolio(pairs as any, initialAmounts as any);
    const balance = portfolio.get(assetToCheck);

    expect(balance?.total).toBe(expectedTotal);
  });

  it.each([
    { asset: 'BTC', initial: 5 },
    { asset: 'USDT', initial: 100 },
  ])('sets free balance equal to total balance initially for $asset', ({ asset, initial }) => {
    const initialAmounts = new Map([[asset, initial]]);
    const portfolio = initializePortfolio(['BTC/USDT'], initialAmounts as any);

    expect(portfolio.get(asset)?.free).toBe(initial);
  });

  it('sets used balance to 0 initially', () => {
    const initialAmounts = new Map([['BTC', 5]]);
    const portfolio = initializePortfolio(['BTC/USDT'], initialAmounts as any);

    expect(portfolio.get('BTC')?.used).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAssetBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('getAssetBalance', () => {
  it('returns the balance when asset exists in portfolio', () => {
    const portfolio: Portfolio = new Map([['BTC', createBalanceDetail(1, 0.5, 1.5)]]);
    expect(getAssetBalance(portfolio, 'BTC')).toEqual({ free: 1, used: 0.5, total: 1.5 });
  });

  it('returns ZERO_BALANCE when asset does not exist', () => {
    const portfolio: Portfolio = new Map();
    expect(getAssetBalance(portfolio, 'UNKNOWN')).toEqual(ZERO_BALANCE);
  });

  it('returns a new object (copy of ZERO_BALANCE) when symbol does not exist', () => {
    const portfolio: Portfolio = new Map();
    const balance1 = getAssetBalance(portfolio, 'UNKNOWN');
    const balance2 = getAssetBalance(portfolio, 'UNKNOWN');

    expect(balance1).not.toBe(balance2);
  });

  it('returns equal values to ZERO_BALANCE when asset does not exist', () => {
    const portfolio: Portfolio = new Map();
    expect(getAssetBalance(portfolio, 'UNKNOWN')).toEqual(ZERO_BALANCE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateAssetBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('updateAssetBalance', () => {
  it('adds a new balance to the portfolio if it did not exist', () => {
    const portfolio: Portfolio = new Map();
    updateAssetBalance(portfolio, 'BTC', createBalanceDetail(5, 0, 5));

    expect(portfolio.get('BTC')).toEqual({ free: 5, used: 0, total: 5 });
  });

  it('overwrites an existing balance in the portfolio', () => {
    const portfolio: Portfolio = new Map([['BTC', createBalanceDetail(1, 0, 1)]]);
    updateAssetBalance(portfolio, 'BTC', createBalanceDetail(10, 2, 12));

    expect(portfolio.get('BTC')).toEqual({ free: 10, used: 2, total: 12 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isPortfolioEmpty
// ─────────────────────────────────────────────────────────────────────────────

describe('isPortfolioEmpty', () => {
  it.each([
    { description: 'empty Map', entries: [], expected: true },
    { description: 'single entry with zero total', entries: [['BTC', { free: 0, used: 0, total: 0 }]], expected: true },
    {
      description: 'multiple entries all with zero totals',
      entries: [
        ['BTC', { free: 0, used: 0, total: 0 }],
        ['ETH', { free: 0, used: 0, total: 0 }],
      ],
      expected: true,
    },
    { description: 'single entry with positive total', entries: [['BTC', { free: 1, used: 0, total: 1 }]], expected: false },
    {
      description: 'first entry with positive total',
      entries: [
        ['BTC', { free: 1, used: 0, total: 1 }],
        ['ETH', { free: 0, used: 0, total: 0 }],
      ],
      expected: false,
    },
    {
      description: 'second entry with positive total',
      entries: [
        ['BTC', { free: 0, used: 0, total: 0 }],
        ['ETH', { free: 5, used: 0, total: 5 }],
      ],
      expected: false,
    },
  ])('returns $expected for $description', ({ entries, expected }) => {
    const portfolio: Portfolio = new Map(entries as any);
    expect(isPortfolioEmpty(portfolio)).toBe(expected);
  });
});

describe('calculatePortfolioTotalValue', () => {
  it.each([
    {
      description: 'empty portfolio',
      portfolioEntries: [],
      prices: [],
      currency: 'USDT',
      assets: ['BTC', 'ETH'],
      expected: 0,
    },
    {
      description: 'portfolio with only currency',
      portfolioEntries: [['USDT', createBalanceDetail(100, 0, 100)]],
      prices: [],
      currency: 'USDT',
      assets: ['BTC', 'ETH'],
      expected: 100,
    },
    {
      description: 'portfolio with single asset and price',
      portfolioEntries: [
        ['USDT', createBalanceDetail(100, 0, 100)],
        ['BTC', createBalanceDetail(1, 0, 1)],
      ],
      prices: [['BTC/USDT', 50000]],
      currency: 'USDT',
      assets: ['BTC'],
      expected: 50100, // 100 + 1 * 50000
    },
    {
      description: 'portfolio with multiple assets and prices',
      portfolioEntries: [
        ['USDT', createBalanceDetail(100, 0, 100)],
        ['BTC', createBalanceDetail(0.5, 0, 0.5)],
        ['ETH', createBalanceDetail(10, 0, 10)],
      ],
      prices: [
        ['BTC/USDT', 50000],
        ['ETH/USDT', 3000],
      ],
      currency: 'USDT',
      assets: ['BTC', 'ETH'],
      expected: 55100, // 100 + 0.5 * 50000 + 10 * 3000 = 100 + 25000 + 30000
    },
    {
      description: 'ignores assets without price',
      portfolioEntries: [
        ['USDT', createBalanceDetail(100, 0, 100)],
        ['BTC', createBalanceDetail(1, 0, 1)],
        ['XRP', createBalanceDetail(1000, 0, 1000)],
      ],
      prices: [['BTC/USDT', 50000]],
      currency: 'USDT',
      assets: ['BTC', 'XRP'],
      expected: 50100, // XRP ignored as no price
    },
    {
      description: 'ignores currency in assets list to avoid double counting',
      portfolioEntries: [['USDT', createBalanceDetail(100, 0, 100)]],
      prices: [],
      currency: 'USDT',
      assets: ['USDT'], // Should be ignored in loop
      expected: 100, // 100 + 0 (loop skipped)
    },
    {
      description: 'handles missing asset balance by defaulting to zero (via getAssetBalance)',
      portfolioEntries: [['USDT', createBalanceDetail(100, 0, 100)]],
      prices: [['BTC/USDT', 50000]],
      currency: 'USDT',
      assets: ['BTC'], // BTC in assets but not in portfolio
      expected: 100, // 100 + 0 * 50000
    },
  ])('$description', ({ portfolioEntries, prices, currency, assets, expected }) => {
    const portfolio = new Map(portfolioEntries as any) as Portfolio;
    const priceMap = new Map(prices as any) as Map<TradingPair, number>;

    const total = calculatePortfolioTotalValue(portfolio, priceMap, currency as Asset, assets as Asset[]);

    expect(total).toBe(expected);
  });
});
