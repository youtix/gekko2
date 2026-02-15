import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { describe, expect, it, vi } from 'vitest';
import { computeOrderPricing, PortfolioUpdatesConfig, shouldEmitPortfolio } from './trader.utils';

// Mock logger
vi.mock('@services/logger', () => ({
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

const warningMock = vi.mocked(warning);

describe('trader.utils', () => {
  describe('computeOrderPricing', () => {
    it.each`
      description                           | side      | price  | amount | feePercent   | expected
      ${'apply fee markup for BUY side'}    | ${'BUY'}  | ${100} | ${2}   | ${0.75}      | ${{ effectivePrice: 100.75, base: 200, fee: 1.5, total: 201.5 }}
      ${'apply fee discount for SELL side'} | ${'SELL'} | ${100} | ${2}   | ${0.5}       | ${{ effectivePrice: 99.5, base: 200, fee: 1, total: 199 }}
      ${'handle zero fee without warning'}  | ${'SELL'} | ${250} | ${3}   | ${0}         | ${{ effectivePrice: 250, base: 750, fee: 0, total: 750 }}
      ${'handle no fee (undefined)'}        | ${'BUY'}  | ${150} | ${3}   | ${undefined} | ${{ effectivePrice: 150, base: 450, fee: 0, total: 450 }}
      ${'handle no fee (negative)'}         | ${'BUY'}  | ${150} | ${3}   | ${-1}        | ${{ effectivePrice: 150, base: 450, fee: 0, total: 450 }}
    `('should $description', ({ side, price, amount, feePercent, expected }) => {
      const result = computeOrderPricing(side, price, amount, feePercent);
      expect(result).toEqual(expected);

      if (feePercent === undefined) {
        expect(warningMock).toHaveBeenCalledWith('trader', expect.stringContaining('Exchange did not provide fee information'));
      }
    });

    it.each`
      description                   | price | amount
      ${'price is not positive'}    | ${0}  | ${1}
      ${'amount is not positive'}   | ${10} | ${0}
      ${'price and amount invalid'} | ${-5} | ${-10}
    `('should throw when $description', ({ price, amount }) => {
      expect(() => computeOrderPricing('BUY', price, amount, 0.5)).toThrowError(/Invalid order inputs/);
    });
  });

  describe('shouldEmitPortfolio', () => {
    const defaultPairs: TradingPair[] = ['BTC/USDT'];
    const defaultConfig: PortfolioUpdatesConfig = { threshold: 1, dust: 1 };

    // Helper to create portfolio
    const makePortfolio = (assets: Record<string, number>): Portfolio => {
      const p = new Map<string, BalanceDetail>();
      for (const [asset, total] of Object.entries(assets)) {
        p.set(asset, { free: total, used: 0, total });
      }
      return p;
    };

    // Helper to create prices
    const makePrices = (prices: Record<string, number>): Map<TradingPair, number> => {
      const p = new Map<TradingPair, number>();
      for (const [pair, price] of Object.entries(prices)) {
        p.set(pair as TradingPair, price);
      }
      return p;
    };

    const prices = makePrices({ 'BTC/USDT': 100 });

    it.each`
      description                                                   | current                         | lastEmitted                     | expected
      ${'return true when lastEmitted is null (first sync)'}        | ${{ BTC: 1 }}                   | ${null}                         | ${true}
      ${'return false when no asset exceeds threshold'}             | ${{ BTC: 1.005, USDT: 1000 }}   | ${{ BTC: 1, USDT: 1000 }}       | ${false}
      ${'return true when one asset exceeds threshold'}             | ${{ BTC: 1.05, USDT: 1000 }}    | ${{ BTC: 1, USDT: 1000 }}       | ${true}
      ${'ignore asset below dust even if change is huge'}           | ${{ BTC: 0.00002, USDT: 1000 }} | ${{ BTC: 0.00001, USDT: 1000 }} | ${false}
      ${'return true when new asset appears with value >= dust'}    | ${{ BTC: 0.1, USDT: 1000 }}     | ${{ USDT: 1000 }}               | ${true}
      ${'return true when asset is removed and prev value >= dust'} | ${{ USDT: 1000 }}               | ${{ BTC: 1, USDT: 1000 }}       | ${true}
      ${'detect quote currency change above threshold'}             | ${{ BTC: 1, USDT: 1050 }}       | ${{ BTC: 1, USDT: 1000 }}       | ${true}
      ${'return true when prev qty 0 and current > dust'}           | ${{ BTC: 0.5, USDT: 1000 }}     | ${{ BTC: 0, USDT: 1000 }}       | ${true}
      ${'return false when new asset is below dust'}                | ${{ BTC: 0.00001, USDT: 1000 }} | ${{ USDT: 1000 }}               | ${false}
    `('should $description', ({ current, lastEmitted, expected }) => {
      const currentP = makePortfolio(current);
      const lastP = lastEmitted ? makePortfolio(lastEmitted) : null;

      expect(
        shouldEmitPortfolio({
          current: currentP,
          lastEmitted: lastP,
          prices,
          pairs: defaultPairs,
          portfolioConfig: defaultConfig,
        }),
      ).toBe(expected);
    });
  });
});
