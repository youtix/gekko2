import { warning } from '@services/logger';
import { describe, expect, it, vi } from 'vitest';
import { computeOrderPricing } from './trader.utils';

vi.mock('@services/logger', () => ({
  warning: vi.fn(),
}));

const warningMock = vi.mocked(warning);

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
