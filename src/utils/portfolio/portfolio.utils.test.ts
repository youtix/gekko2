import { describe, expect, it } from 'vitest';

import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import {
  clonePortfolio,
  createEmptyPortfolio,
  createPortfolio,
  getBalance,
  isEmptyPortfolio,
  setBalance,
} from './portfolio.utils';

const createTestPortfolio = (
  legacyPortfolio: { asset: BalanceDetail; currency: BalanceDetail },
  assetKey = 'BTC',
  currencyKey = 'USDT',
): Portfolio => {
  const portfolio = new Map<string, BalanceDetail>();
  portfolio.set(assetKey, legacyPortfolio.asset);
  portfolio.set(currencyKey, legacyPortfolio.currency);
  return portfolio;
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Data Factories
// ─────────────────────────────────────────────────────────────────────────────

const createBalanceDetail = (free = 0, used = 0, total = 0): BalanceDetail => ({ free, used, total });

// ─────────────────────────────────────────────────────────────────────────────
// createEmptyPortfolio
// ─────────────────────────────────────────────────────────────────────────────

describe('createEmptyPortfolio', () => {
  it('returns a Map instance', () => {
    expect(createEmptyPortfolio()).toBeInstanceOf(Map);
  });

  it('returns an empty Map', () => {
    expect(createEmptyPortfolio().size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createPortfolio
// ─────────────────────────────────────────────────────────────────────────────

describe('createPortfolio', () => {
  it('returns a Map instance', () => {
    const assetBalance = createBalanceDetail(1, 0, 1);
    const currencyBalance = createBalanceDetail(100, 0, 100);

    expect(createPortfolio('BTC', assetBalance, 'USDT', currencyBalance)).toBeInstanceOf(Map);
  });

  it('creates a portfolio with 2 entries', () => {
    const assetBalance = createBalanceDetail(1, 0, 1);
    const currencyBalance = createBalanceDetail(100, 0, 100);

    expect(createPortfolio('ETH', assetBalance, 'EUR', currencyBalance).size).toBe(2);
  });

  it.each`
    asset    | assetFree | currency  | currencyFree | symbol    | expectedFree
    ${'BTC'} | ${0.5}    | ${'USDT'} | ${1000}      | ${'BTC'}  | ${0.5}
    ${'BTC'} | ${0.5}    | ${'USDT'} | ${1000}      | ${'USDT'} | ${1000}
    ${'ETH'} | ${10}     | ${'EUR'}  | ${500}       | ${'ETH'}  | ${10}
    ${'ETH'} | ${10}     | ${'EUR'}  | ${500}       | ${'EUR'}  | ${500}
  `(
    'portfolio.get($symbol).free equals $expectedFree when asset=$asset, currency=$currency',
    ({ asset, assetFree, currency, currencyFree, symbol, expectedFree }) => {
      const assetBalance = createBalanceDetail(assetFree, 0, assetFree);
      const currencyBalance = createBalanceDetail(currencyFree, 0, currencyFree);
      const portfolio = createPortfolio(asset, assetBalance, currency, currencyBalance);

      expect(portfolio.get(symbol)?.free).toBe(expectedFree);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// getBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('getBalance', () => {
  it('returns the balance when symbol exists in portfolio', () => {
    const portfolio: Portfolio = new Map([['BTC', createBalanceDetail(1, 0.5, 1.5)]]);

    expect(getBalance(portfolio, 'BTC')).toEqual({ free: 1, used: 0.5, total: 1.5 });
  });

  it('returns empty balance when symbol does not exist', () => {
    const portfolio: Portfolio = new Map();

    expect(getBalance(portfolio, 'UNKNOWN')).toEqual({ free: 0, used: 0, total: 0 });
  });

  it('returns a new object (not the same reference) when symbol does not exist', () => {
    const portfolio: Portfolio = new Map();
    const balance1 = getBalance(portfolio, 'UNKNOWN');
    const balance2 = getBalance(portfolio, 'UNKNOWN');

    expect(balance1).not.toBe(balance2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('setBalance', () => {
  it('adds a new balance to the portfolio', () => {
    const portfolio: Portfolio = new Map();
    setBalance(portfolio, 'BTC', createBalanceDetail(5, 0, 5));

    expect(portfolio.get('BTC')).toEqual({ free: 5, used: 0, total: 5 });
  });

  it('overwrites an existing balance in the portfolio', () => {
    const portfolio: Portfolio = new Map([['BTC', createBalanceDetail(1, 0, 1)]]);
    setBalance(portfolio, 'BTC', createBalanceDetail(10, 2, 12));

    expect(portfolio.get('BTC')).toEqual({ free: 10, used: 2, total: 12 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clonePortfolio
// ─────────────────────────────────────────────────────────────────────────────

describe('clonePortfolio', () => {
  it('returns a new Map instance (not the same reference)', () => {
    const original: Portfolio = new Map([['BTC', createBalanceDetail(1, 0, 1)]]);
    const cloned = clonePortfolio(original);

    expect(cloned).not.toBe(original);
  });

  it('clones all entries from the original portfolio', () => {
    const original: Portfolio = new Map([
      ['BTC', createBalanceDetail(1, 0, 1)],
      ['ETH', createBalanceDetail(10, 5, 15)],
    ]);
    const cloned = clonePortfolio(original);

    expect(cloned.size).toBe(2);
  });

  it('clones balance values correctly', () => {
    const original: Portfolio = new Map([['USDT', createBalanceDetail(1000, 200, 1200)]]);
    const cloned = clonePortfolio(original);

    expect(cloned.get('USDT')).toEqual({ free: 1000, used: 200, total: 1200 });
  });

  it('clones balance objects (not the same reference)', () => {
    const originalBalance = createBalanceDetail(1, 0, 1);
    const original: Portfolio = new Map([['BTC', originalBalance]]);
    const cloned = clonePortfolio(original);

    expect(cloned.get('BTC')).not.toBe(originalBalance);
  });

  it('returns an empty Map when cloning an empty portfolio', () => {
    const cloned = clonePortfolio(new Map());

    expect(cloned.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isEmptyPortfolio
// ─────────────────────────────────────────────────────────────────────────────

describe('isEmptyPortfolio', () => {
  it.each`
    description                                | entries                                                                               | expected
    ${'empty Map'}                             | ${[]}                                                                                 | ${true}
    ${'single entry with zero total'}          | ${[['BTC', { free: 0, used: 0, total: 0 }]]}                                          | ${true}
    ${'multiple entries all with zero totals'} | ${[['BTC', { free: 0, used: 0, total: 0 }], ['ETH', { free: 0, used: 0, total: 0 }]]} | ${true}
    ${'single entry with positive total'}      | ${[['BTC', { free: 1, used: 0, total: 1 }]]}                                          | ${false}
    ${'first entry with positive total'}       | ${[['BTC', { free: 1, used: 0, total: 1 }], ['ETH', { free: 0, used: 0, total: 0 }]]} | ${false}
    ${'second entry with positive total'}      | ${[['BTC', { free: 0, used: 0, total: 0 }], ['ETH', { free: 5, used: 0, total: 5 }]]} | ${false}
  `('returns $expected for $description', ({ entries, expected }) => {
    const portfolio: Portfolio = new Map(entries);

    expect(isEmptyPortfolio(portfolio)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createTestPortfolio
// ─────────────────────────────────────────────────────────────────────────────

describe('createTestPortfolio', () => {
  it('returns a Map instance', () => {
    const legacy = { asset: createBalanceDetail(1, 0, 1), currency: createBalanceDetail(100, 0, 100) };

    expect(createTestPortfolio(legacy)).toBeInstanceOf(Map);
  });

  it('creates a portfolio with 2 entries', () => {
    const legacy = { asset: createBalanceDetail(1, 0, 1), currency: createBalanceDetail(100, 0, 100) };

    expect(createTestPortfolio(legacy).size).toBe(2);
  });

  it('uses default keys BTC and USDT when no keys provided', () => {
    const legacy = { asset: createBalanceDetail(1, 0, 1), currency: createBalanceDetail(100, 0, 100) };
    const portfolio = createTestPortfolio(legacy);

    expect(portfolio.has('BTC')).toBe(true);
  });

  it('maps asset to BTC by default', () => {
    const legacy = { asset: createBalanceDetail(5, 2, 7), currency: createBalanceDetail(100, 0, 100) };
    const portfolio = createTestPortfolio(legacy);

    expect(portfolio.get('BTC')).toEqual({ free: 5, used: 2, total: 7 });
  });

  it('maps currency to USDT by default', () => {
    const legacy = { asset: createBalanceDetail(1, 0, 1), currency: createBalanceDetail(500, 100, 600) };
    const portfolio = createTestPortfolio(legacy);

    expect(portfolio.get('USDT')).toEqual({ free: 500, used: 100, total: 600 });
  });

  it('uses custom asset key when provided', () => {
    const legacy = { asset: createBalanceDetail(10, 0, 10), currency: createBalanceDetail(100, 0, 100) };
    const portfolio = createTestPortfolio(legacy, 'ETH');

    expect(portfolio.has('ETH')).toBe(true);
  });

  it('uses custom currency key when provided', () => {
    const legacy = { asset: createBalanceDetail(1, 0, 1), currency: createBalanceDetail(100, 0, 100) };
    const portfolio = createTestPortfolio(legacy, 'BTC', 'EUR');

    expect(portfolio.has('EUR')).toBe(true);
  });

  it('maps asset to custom key correctly', () => {
    const legacy = { asset: createBalanceDetail(20, 5, 25), currency: createBalanceDetail(100, 0, 100) };
    const portfolio = createTestPortfolio(legacy, 'SOL', 'USDC');

    expect(portfolio.get('SOL')).toEqual({ free: 20, used: 5, total: 25 });
  });

  it('maps currency to custom key correctly', () => {
    const legacy = { asset: createBalanceDetail(1, 0, 1), currency: createBalanceDetail(750, 250, 1000) };
    const portfolio = createTestPortfolio(legacy, 'SOL', 'USDC');

    expect(portfolio.get('USDC')).toEqual({ free: 750, used: 250, total: 1000 });
  });
});
