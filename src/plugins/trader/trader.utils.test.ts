import { warning } from '@services/logger';
import { describe, expect, it, vi } from 'vitest';
import { computeOrderPricing, findWhyWeCannotBuy, findWhyWeCannotSell, resolveOrderAmount } from './trader.utils';

vi.mock('@services/logger', () => ({
  warning: vi.fn(),
}));

const warningMock = vi.mocked(warning);

describe('resolveOrderAmount', () => {
  it.each`
    description                                                 | portfolio                        | currentPrice | side      | quantity     | expected
    ${'return the provided quantity when quantity is positive'} | ${{ currency: 120, asset: 5 }}   | ${50}        | ${'BUY'}  | ${3}         | ${3}
    ${'return zero for BUY side when price is not positive'}    | ${{ currency: 120, asset: 5 }}   | ${0}         | ${'BUY'}  | ${undefined} | ${0}
    ${'return discounted currency-based amount for BUY side'}   | ${{ currency: 190, asset: 5 }}   | ${20}        | ${'BUY'}  | ${undefined} | ${9.025}
    ${'return the asset balance for SELL side'}                 | ${{ currency: 120, asset: 7.5 }} | ${42}        | ${'SELL'} | ${undefined} | ${7.5}
  `('should $description', ({ portfolio, currentPrice, side, quantity, expected }) => {
    expect(resolveOrderAmount(portfolio, currentPrice, side, quantity)).toBeCloseTo(expected);
  });
});

describe('findWhyWeCannotBuy', () => {
  it.each`
    description                | amount
    ${'amount equal to zero'}  | ${0}
    ${'amount less than zero'} | ${-1.23}
  `('should flag invalid amount when $description', ({ amount }) => {
    const result = findWhyWeCannotBuy(amount, 10, 100, 'USD');
    expect(result).toBe(`invalid amount (${amount})`);
  });

  it.each`
    description               | price
    ${'price equal to zero'}  | ${0}
    ${'price less than zero'} | ${-9.99}
  `('should flag invalid price when $description', ({ price }) => {
    const result = findWhyWeCannotBuy(2, price, 100, 'USD');
    expect(result).toBe(`invalid price (${price})`);
  });

  it.each`
    description                            | amount | price | currencyAmount | currencySymbol | expected
    ${'currency balance covers the order'} | ${2}   | ${10} | ${25}          | ${'USD'}       | ${'need 20.00000000 USD, have 25.00000000 USD, shortfall 0.00000000 USD'}
    ${'currency balance is insufficient'}  | ${3.5} | ${12} | ${10}          | ${'EUR'}       | ${'need 42.00000000 EUR, have 10.00000000 EUR, shortfall 32.00000000 EUR'}
  `(
    'should explain why buying fails when $description',
    ({ amount, price, currencyAmount, currencySymbol, expected }) => {
      const result = findWhyWeCannotBuy(amount, price, currencyAmount, currencySymbol);
      expect(result).toBe(expected);
    },
  );
});

describe('findWhyWeCannotSell', () => {
  it.each`
    description                | amount
    ${'amount equal to zero'}  | ${0}
    ${'amount less than zero'} | ${-3}
  `('should flag invalid amount when $description', ({ amount }) => {
    const result = findWhyWeCannotSell(amount, 10, 100, 'BTC');
    expect(result).toBe(`invalid amount (${amount})`);
  });

  it.each`
    description               | price
    ${'price equal to zero'}  | ${0}
    ${'price less than zero'} | ${-12.5}
  `('should flag invalid price when $description', ({ price }) => {
    const result = findWhyWeCannotSell(2, price, 100, 'BTC');
    expect(result).toBe(`invalid price (${price})`);
  });

  it.each`
    description                         | amount | price | assetAmount | assetSymbol | expected
    ${'asset balance covers the order'} | ${1.5} | ${20} | ${5}        | ${'ETH'}    | ${'need 1.50000000 ETH, have 5.00000000 ETH, shortfall 0.00000000 ETH'}
    ${'asset balance is insufficient'}  | ${4.2} | ${20} | ${1.1}      | ${'ETH'}    | ${'need 4.20000000 ETH, have 1.10000000 ETH, shortfall 3.10000000 ETH'}
  `('should explain why selling fails when $description', ({ amount, price, assetAmount, assetSymbol, expected }) => {
    const result = findWhyWeCannotSell(amount, price, assetAmount, assetSymbol);
    expect(result).toBe(expected);
  });
});

describe('computeOrderPricing', () => {
  it.each`
    description                           | side      | price  | amount | feePercent | expected
    ${'apply fee markup for BUY side'}    | ${'BUY'}  | ${100} | ${2}   | ${0.75}    | ${{ effectivePrice: 100.75, base: 200, fee: 1.5, total: 201.5 }}
    ${'apply fee discount for SELL side'} | ${'SELL'} | ${100} | ${2}   | ${0.5}     | ${{ effectivePrice: 99.5, base: 200, fee: 1, total: 199 }}
    ${'handle zero fee without warning'}  | ${'SELL'} | ${250} | ${3}   | ${0}       | ${{ effectivePrice: 250, base: 750, fee: 0, total: 750 }}
  `('should $description', ({ side, price, amount, feePercent, expected }) => {
    const result = computeOrderPricing(side, price, amount, feePercent);
    expect(warningMock).not.toHaveBeenCalled();
    expect(result).toEqual(expected);
  });

  it('should assume no fees and emit warning when feePercent is not provided', () => {
    const result = computeOrderPricing('BUY', 150, 3);
    expect(warningMock).toHaveBeenCalledWith('trader', 'Exchange did not provide fee information, assuming no fees.');
    expect(result).toEqual({ effectivePrice: 150, base: 450, fee: 0, total: 450 });
  });

  it.each`
    description                   | price | amount
    ${'price is not positive'}    | ${0}  | ${1}
    ${'amount is not positive'}   | ${10} | ${0}
    ${'price and amount invalid'} | ${-5} | ${-10}
  `('should throw when $description', ({ price, amount }) => {
    expect(() => computeOrderPricing('BUY', price, amount, 0.5)).toThrowError(
      'Invalid order inputs: price must be > 0 and amount must be > 0',
    );
  });
});
