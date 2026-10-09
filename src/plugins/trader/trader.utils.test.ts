import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { describe, expect, it, vi } from 'vitest';
import { computeOrderPricing, getBuyBudget, PortfolioUpdatesConfig, shouldEmitPortfolio } from './trader.utils';

// Mock logger
vi.mock('@services/logger', () => ({
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

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
    });

    // In binary, and as the total over the amount, each came out an ulp or two off: the effective price of the first at
    // 100.05000400000002, that of the second at 104.54444000000001, the fee of the third at 0.06630148799999999, the total of the
    // fourth at 497.31386523983997
    it.each`
      side      | price     | amount     | feePercent | expected
      ${'BUY'}  | ${100.01} | ${4.99825} | ${0.04}    | ${{ effectivePrice: 100.050004, base: 499.8749825, fee: 0.199949993, total: 500.074932493 }}
      ${'BUY'}  | ${104.44} | ${0.12}    | ${0.1}     | ${{ effectivePrice: 104.54444, base: 12.5328, fee: 0.0125328, total: 12.5453328 }}
      ${'SELL'} | ${99}     | ${1.67428} | ${0.04}    | ${{ effectivePrice: 98.9604, base: 165.75372, fee: 0.066301488, total: 165.687418512 }}
      ${'SELL'} | ${99.99}  | ${4.97712} | ${0.07}    | ${{ effectivePrice: 99.920007, base: 497.6622288, fee: 0.34836356016, total: 497.31386523984 }}
    `(
      'works out the $side of $amount at $price with a fee of $feePercent % in decimal',
      ({ side, price, amount, feePercent, expected }) => {
        expect(computeOrderPricing(side, price, amount, feePercent)).toEqual(expected);
      },
    );

    it.each`
      description                   | price | amount
      ${'price is not positive'}    | ${0}  | ${1}
      ${'amount is not positive'}   | ${10} | ${0}
      ${'price and amount invalid'} | ${-5} | ${-10}
    `('should return NaNs when $description', ({ price, amount }) => {
      const result = computeOrderPricing('BUY', price, amount, 0.5);
      expect(result).toEqual({ effectivePrice: NaN, base: NaN, fee: NaN, total: NaN });
    });
  });

  // The currency an all-in BUY of that amount is sized from at that price: what it buys is 95 % of it, the 5 % left kept back for the
  // fee. In binary, the cost of the last two comes out an ulp off (114.99999999999999 and 7.000000000000001), and so does their budget.
  describe('getBuyBudget', () => {
    it.each`
      amount     | price  | budget
      ${9.5}     | ${100} | ${1000}
      ${4.75}    | ${100} | ${500}
      ${2}       | ${95}  | ${200}
      ${0.00095} | ${100} | ${0.1}
      ${1.15}    | ${100} | ${121.05263157894737}
      ${0.07}    | ${100} | ${7.36842105263158}
    `('is $budget for a BUY of $amount at $price', ({ amount, price, budget }) => {
      expect(getBuyBudget(amount, price)).toBe(budget);
    });
  });

  describe('shouldEmitPortfolio', () => {
    // ETH/USDT has no price: ETH is valued at 0, like BNB, which is outside the pairs
    const defaultPairs: TradingPair[] = ['BTC/USDT', 'ETH/USDT'];
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

    const callShouldEmitPortfolio = (
      current: Record<string, number>,
      lastEmitted: Record<string, number> | null,
      portfolioConfig: PortfolioUpdatesConfig,
    ) =>
      shouldEmitPortfolio({
        current: makePortfolio(current),
        lastEmitted: lastEmitted ? makePortfolio(lastEmitted) : null,
        prices,
        pairs: defaultPairs,
        portfolioConfig,
      });

    // 1 BTC is worth 100 USDT and the dust is 1 USDT, so below 0.01 BTC, BTC is dust. Trading 0.05 BTC moves 1000 USDT by 0.5%, below
    // the threshold: only the BTC leg can get such a trade emitted
    it.each`
      description                                                   | current                         | lastEmitted                     | expected
      ${'emit on the first sync (lastEmitted is null)'}             | ${{ BTC: 1 }}                   | ${null}                         | ${true}
      ${'emit a sell-out to 0, the asset still in the balance'}     | ${{ BTC: 0, USDT: 1005 }}       | ${{ BTC: 0.05, USDT: 1000 }}    | ${true}
      ${'emit a sell-out to below the dust'}                        | ${{ BTC: 0.005, USDT: 1004.5 }} | ${{ BTC: 0.05, USDT: 1000 }}    | ${true}
      ${'emit a sell-out that removed the asset from the balance'}  | ${{ USDT: 1005 }}               | ${{ BTC: 0.05, USDT: 1000 }}    | ${true}
      ${'emit a buy-in from 0'}                                     | ${{ BTC: 0.05, USDT: 995 }}     | ${{ BTC: 0, USDT: 1000 }}       | ${true}
      ${'emit a buy-in of an asset missing from lastEmitted'}       | ${{ BTC: 0.05, USDT: 995 }}     | ${{ USDT: 1000 }}               | ${true}
      ${'emit a change of an asset above the threshold'}            | ${{ BTC: 1.05, USDT: 1000 }}    | ${{ BTC: 1, USDT: 1000 }}       | ${true}
      ${'emit a change of the quote currency above the threshold'}  | ${{ BTC: 1, USDT: 1050 }}       | ${{ BTC: 1, USDT: 1000 }}       | ${true}
      ${'not emit a change at the threshold'}                       | ${{ BTC: 1, USDT: 1010 }}       | ${{ BTC: 1, USDT: 1000 }}       | ${false}
      ${'not emit a change below the threshold'}                    | ${{ BTC: 1.005, USDT: 1000 }}   | ${{ BTC: 1, USDT: 1000 }}       | ${false}
      ${'not emit a change of an asset that is dust on both sides'} | ${{ BTC: 0.00002, USDT: 1000 }} | ${{ BTC: 0.00001, USDT: 1000 }} | ${false}
      ${'not emit an asset appearing below the dust'}               | ${{ BTC: 0.00001, USDT: 1000 }} | ${{ USDT: 1000 }}               | ${false}
      ${'not emit a change of an asset of a pair without a price'}  | ${{ ETH: 5, USDT: 1000 }}       | ${{ ETH: 1, USDT: 1000 }}       | ${false}
      ${'not emit a change of an asset outside the pairs'}          | ${{ BNB: 5, USDT: 1000 }}       | ${{ BNB: 1, USDT: 1000 }}       | ${false}
    `('should $description', ({ current, lastEmitted, expected }) => {
      expect(callShouldEmitPortfolio(current, lastEmitted, defaultConfig)).toBe(expected);
    });

    // A quantity of 0 is dust even with a dust of 0: a sell-out to 0 crosses the boundary, where its 100% change is not above a
    // threshold of 100%
    it.each`
      description                               | current                     | lastEmitted                  | expected
      ${'emit a sell-out to 0'}                 | ${{ BTC: 0, USDT: 1005 }}   | ${{ BTC: 0.05, USDT: 1000 }} | ${true}
      ${'emit a buy-in from 0'}                 | ${{ BTC: 0.05, USDT: 995 }} | ${{ BTC: 0, USDT: 1000 }}    | ${true}
      ${'not emit an asset at 0 on both sides'} | ${{ BTC: 0, USDT: 1000 }}   | ${{ BTC: 0, USDT: 1000 }}    | ${false}
    `('should $description with a dust of 0 and a threshold of 100%', ({ current, lastEmitted, expected }) => {
      expect(callShouldEmitPortfolio(current, lastEmitted, { threshold: 100, dust: 0 })).toBe(expected);
    });
  });
});
