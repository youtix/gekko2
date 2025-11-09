import { warning } from '@services/logger';
import { describe, expect, it, vi } from 'vitest';
import { computeOrderPricing, resolveOrderAmount } from './trader.utils';

vi.mock('@services/logger', () => ({
  warning: vi.fn(),
}));

const warningMock = vi.mocked(warning);

describe('resolveOrderAmount', () => {
  it.each`
    description                                                     | portfolio                        | currentPrice | side      | quantity     | marketLimits                                                                                            | expected
    ${'return the provided quantity when quantity is positive'}     | ${{ currency: 120, asset: 5 }}   | ${50}        | ${'BUY'}  | ${3}         | ${undefined}                                                                                            | ${3}
    ${'return zero for BUY side when price is not positive'}        | ${{ currency: 120, asset: 5 }}   | ${0}         | ${'BUY'}  | ${undefined} | ${undefined}                                                                                            | ${0}
    ${'return discounted currency-based amount for BUY side'}       | ${{ currency: 190, asset: 5 }}   | ${20}        | ${'BUY'}  | ${undefined} | ${undefined}                                                                                            | ${9.025}
    ${'respect min cost when buffer would go below limit'}          | ${{ currency: 10.2, asset: 5 }}  | ${1}         | ${'BUY'}  | ${undefined} | ${{ price: { min: 1, max: 10_000 }, amount: { min: 0.0001, max: 100 }, cost: { min: 10, max: 1_000 } }} | ${10}
    ${'fallback to affordable amount when min cost is unreachable'} | ${{ currency: 5, asset: 5 }}     | ${1}         | ${'BUY'}  | ${undefined} | ${{ price: { min: 1, max: 10_000 }, amount: { min: 0.0001, max: 100 }, cost: { min: 10, max: 1_000 } }} | ${5}
    ${'return the asset balance for SELL side'}                     | ${{ currency: 120, asset: 7.5 }} | ${42}        | ${'SELL'} | ${undefined} | ${undefined}                                                                                            | ${7.5}
  `('should $description', ({ portfolio, currentPrice, side, quantity, marketLimits, expected }) => {
    expect(resolveOrderAmount(portfolio, currentPrice, side, quantity, marketLimits)).toBeCloseTo(expected);
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
