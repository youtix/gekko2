import { ORDER_ERRORED_EVENT } from '@constants/event.const';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { LimitOrder } from '@services/core/order/limit/limitOrder';
import { ExchangeNetworkError } from '@services/exchange/exchange.error';
import { MarketData } from '@services/exchange/exchange.types';
import { omit } from 'lodash-es';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridBot } from './gridBot.strategy';
import { GridBotStrategyParams, GridBounds } from './gridBot.types';
import {
  applyAmountLimits,
  applyCostLimits,
  computeGridBounds,
  computeLevelPrice,
  computeRebalancePlan,
  countDecimals,
  deriveLevelQuantity,
  hasOnlyOneSide,
  inferAmountPrecision,
  inferPricePrecision,
  isOutcomeUnknown,
  isOutOfRange,
  roundAmount,
  roundPrice,
  validateConfig,
} from './gridBot.utils';

// For isOutcomeUnknown, which reads the reason a real LimitOrder ends with: its configuration, its exchange and its logs
const { fakeExchange } = vi.hoisted(() => ({ fakeExchange: { createLimitOrder: vi.fn() } }));
vi.mock('@services/configuration/configuration', () => ({
  config: { getWatch: () => ({ mode: 'backtest' }), getExchange: () => ({ orderSynchInterval: 1000 }) },
}));
vi.mock('@services/injecter/injecter', () => ({ inject: { exchange: () => fakeExchange } }));
vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }));

describe('gridBot.utils', () => {
  describe('countDecimals', () => {
    it.each`
      num        | expected
      ${100}     | ${0}
      ${100.5}   | ${1}
      ${100.55}  | ${2}
      ${100.123} | ${3}
      ${1e-7}    | ${7}
      ${1.5e-3}  | ${4}
      ${0.00001} | ${5}
    `('returns $expected for $num', ({ num, expected }) => {
      expect(countDecimals(num)).toBe(expected);
    });

    it('returns default for non-finite numbers', () => {
      expect(countDecimals(Infinity)).toBe(8);
    });
  });

  describe('inferPricePrecision', () => {
    it('uses market data precision when available', () => {
      expect(inferPricePrecision(100, { precision: { price: 0.01 } })).toEqual({
        priceDecimals: 2,
        priceStep: 0.01,
      });
    });

    it('falls back to current price decimals', () => {
      expect(inferPricePrecision(123.456, {})).toEqual({ priceDecimals: 3 });
    });

    it('handles zero precision in market data', () => {
      expect(inferPricePrecision(100.5, { precision: { price: 0 } })).toEqual({ priceDecimals: 1 });
    });
  });

  describe('inferAmountPrecision', () => {
    it('uses market data precision when available', () => {
      expect(inferAmountPrecision({ precision: { amount: 0.001 } })).toBe(3);
    });

    it('returns default when not available', () => {
      expect(inferAmountPrecision({})).toBe(8);
    });
  });

  describe('roundPrice', () => {
    it.each`
      value      | decimals | step         | expected
      ${100.123} | ${2}     | ${undefined} | ${100.12}
      ${100.126} | ${2}     | ${undefined} | ${100.13}
      ${100.123} | ${2}     | ${0.05}      | ${100.1}
      ${100.13}  | ${2}     | ${0.05}      | ${100.15}
      ${100.025} | ${2}     | ${0.05}      | ${100.05}
    `('rounds $value to $expected (decimals=$decimals, step=$step)', ({ value, decimals, step, expected }) => {
      expect(roundPrice(value, decimals, step)).toBe(expected);
    });

    it('returns 0 for non-finite values', () => {
      expect(roundPrice(Infinity, 2)).toBe(0);
    });
  });

  describe('roundAmount', () => {
    it.each`
      value     | decimals | expected
      ${1.999}  | ${2}     | ${1.99}
      ${1.001}  | ${2}     | ${1}
      ${0.1234} | ${3}     | ${0.123}
    `('rounds $value down to $expected (decimals=$decimals)', ({ value, decimals, expected }) => {
      expect(roundAmount(value, decimals)).toBe(expected);
    });

    it('returns 0 for non-positive values', () => {
      expect(roundAmount(-1, 2)).toBe(0);
    });

    it('returns 0 for non-finite values', () => {
      expect(roundAmount(Infinity, 2)).toBe(0);
    });
  });

  describe('computeLevelPrice', () => {
    const center = 100;
    const decimals = 2;

    describe('fixed spacing', () => {
      it.each`
        index | value | expected
        ${0}  | ${5}  | ${100}
        ${1}  | ${5}  | ${105}
        ${-1} | ${5}  | ${95}
        ${2}  | ${5}  | ${110}
        ${-2} | ${5}  | ${90}
      `('returns $expected for index=$index, value=$value', ({ index, value, expected }) => {
        expect(computeLevelPrice(center, index, decimals, 'fixed', value)).toBe(expected);
      });
    });

    describe('percent spacing', () => {
      it.each`
        index | value | expected
        ${0}  | ${5}  | ${100}
        ${1}  | ${5}  | ${105}
        ${-1} | ${5}  | ${95}
        ${2}  | ${10} | ${120}
        ${-2} | ${10} | ${80}
      `('returns $expected for index=$index, value=$value', ({ index, value, expected }) => {
        expect(computeLevelPrice(center, index, decimals, 'percent', value)).toBe(expected);
      });
    });

    describe('logarithmic spacing', () => {
      it.each`
        index | value  | expected
        ${0}  | ${0.1} | ${100}
        ${1}  | ${0.1} | ${110}
        ${-1} | ${0.1} | ${90.91}
        ${2}  | ${0.1} | ${121}
      `('returns $expected for index=$index, value=$value', ({ index, value, expected }) => {
        expect(computeLevelPrice(center, index, decimals, 'logarithmic', value)).toBe(expected);
      });

      it('returns 0 for invalid multiplier', () => {
        expect(computeLevelPrice(center, 1, decimals, 'logarithmic', -2)).toBe(0);
      });
    });
  });

  describe('computeGridBounds', () => {
    it('returns correct bounds for symmetric grid', () => {
      expect(computeGridBounds(100, 2, 2, 2, 'fixed', 5)).toEqual({ min: 90, max: 110 });
    });

    it('returns correct bounds for asymmetric grid', () => {
      expect(computeGridBounds(100, 1, 3, 2, 'fixed', 5)).toEqual({ min: 95, max: 115 });
    });

    it('returns null for zero levels', () => {
      expect(computeGridBounds(100, 0, 0, 2, 'fixed', 5)).toBeNull();
    });

    it('returns null for invalid prices', () => {
      expect(computeGridBounds(10, 5, 2, 2, 'fixed', 5)).toBeNull();
    });

    it('handles only buy levels', () => {
      expect(computeGridBounds(100, 2, 0, 2, 'fixed', 5)).toEqual({ min: 90, max: 100 });
    });

    it('handles only sell levels', () => {
      expect(computeGridBounds(100, 0, 2, 2, 'fixed', 5)).toEqual({ min: 100, max: 110 });
    });
  });

  describe('isOutOfRange', () => {
    const bounds: GridBounds = { min: 90, max: 110 };

    it.each`
      price  | expected
      ${80}  | ${true}
      ${90}  | ${false}
      ${100} | ${false}
      ${110} | ${false}
      ${120} | ${true}
    `('returns $expected for price=$price', ({ price, expected }) => {
      expect(isOutOfRange(price, bounds)).toBe(expected);
    });
  });

  // The strategy block as the StrategyManager parses it, without name, before the strategy is created
  describe('schema', () => {
    // The documentation's example, without name
    const block = { buyLevels: 5, sellLevels: 5, spacingType: 'percent', spacingValue: 1, retryOnError: 3 };

    it.each`
      scenario                                    | params                         | expected
      ${'the documentation example'}              | ${block}                       | ${block}
      ${'a block without retryOnError, set to 3'} | ${omit(block, 'retryOnError')} | ${block}
      ${'a grid of sell levels only'}             | ${{ ...block, buyLevels: 0 }}  | ${{ ...block, buyLevels: 0 }}
      ${'a grid of buy levels only'}              | ${{ ...block, sellLevels: 0 }} | ${{ ...block, sellLevels: 0 }}
    `('accepts $scenario', ({ params, expected }) => {
      expect(GridBot.schema.parse(params)).toEqual(expected);
    });

    // Each was handed to the strategy as it was: buyLevel built a grid of SELLs only, 2.5 levels placed BUYs off the prices they
    // were sized on, percentage was reported as non-positive buy prices, and the quoted '0.01' made a multiplier of 10.01
    it.each`
      scenario                                   | params
      ${'an unknown key'}                        | ${{ ...block, levels: 5 }}
      ${'a misspelt level count (buyLevel)'}     | ${{ ...omit(block, 'buyLevels'), buyLevel: 5 }}
      ${'a missing level count'}                 | ${omit(block, 'sellLevels')}
      ${'a fractional level count'}              | ${{ ...block, buyLevels: 2.5 }}
      ${'a negative level count'}                | ${{ ...block, sellLevels: -1 }}
      ${'a quoted level count'}                  | ${{ ...block, buyLevels: '5' }}
      ${'both level counts 0'}                   | ${{ ...block, buyLevels: 0, sellLevels: 0 }}
      ${'an unknown spacingType (percentage)'}   | ${{ ...block, spacingType: 'percentage' }}
      ${'a missing spacingType'}                 | ${omit(block, 'spacingType')}
      ${'a quoted spacingValue'}                 | ${{ ...block, spacingType: 'logarithmic', spacingValue: '0.01' }}
      ${'a spacingValue of 0'}                   | ${{ ...block, spacingValue: 0 }}
      ${'a negative spacingValue'}               | ${{ ...block, spacingValue: -1 }}
      ${'a NaN spacingValue'}                    | ${{ ...block, spacingValue: NaN }}
      ${'an infinite spacingValue'}              | ${{ ...block, spacingValue: Infinity }}
      ${'a missing spacingValue'}                | ${omit(block, 'spacingValue')}
      ${'a retryOnError of 0, once raised to 1'} | ${{ ...block, retryOnError: 0 }}
      ${'a fractional retryOnError'}             | ${{ ...block, retryOnError: 1.5 }}
    `('refuses $scenario', ({ params }) => {
      expect(GridBot.schema.safeParse(params).success).toBe(false);
    });
  });

  describe('validateConfig', () => {
    const validParams: GridBotStrategyParams = {
      buyLevels: 2,
      sellLevels: 2,
      spacingType: 'fixed',
      spacingValue: 5,
      retryOnError: 3,
    };

    it('returns null for valid config', () => {
      expect(validateConfig(validParams, 100, {})).toBeNull();
    });

    it('returns error for non-positive center price', () => {
      expect(validateConfig(validParams, 0, {})).toBe('Center price must be positive');
    });

    it.each`
      buyLevels | spacingType      | spacingValue | expected
      ${25}     | ${'fixed'}       | ${5}         | ${'the lowest of buyLevels 25, spaced by spacingValue 5 (fixed) below the center price 100, would be at -25'}
      ${4}      | ${'percent'}     | ${25}        | ${'the lowest of buyLevels 4, spaced by spacingValue 25 (percent) below the center price 100, would be at 0'}
      ${60}     | ${'logarithmic'} | ${0.1}       | ${'the lowest of buyLevels 60, spaced by spacingValue 0.1 (logarithmic) below the center price 100, would be at 0'}
    `(
      'returns error naming the parameters for non-positive buy prices ($spacingType spacing)',
      ({ buyLevels, spacingType, spacingValue, expected }) => {
        expect(validateConfig({ ...validParams, buyLevels, spacingType, spacingValue }, 100, {})).toBe(
          `Grid configuration would result in non-positive buy prices: ${expected}`,
        );
      },
    );

    it('returns error for price below exchange minimum', () => {
      expect(validateConfig({ ...validParams, buyLevels: 0 }, 0.5, { price: { min: 1 } })).toBe(
        'Center price 0.5 is below exchange minimum 1',
      );
    });

    it('returns error for price above exchange maximum', () => {
      expect(validateConfig(validParams, 1000, { price: { max: 500 } })).toBe('Center price 1000 is above exchange maximum 500');
    });
  });

  describe('applyAmountLimits', () => {
    it.each`
      qty     | min  | max   | expected
      ${5}    | ${1} | ${10} | ${5}
      ${0.5}  | ${1} | ${10} | ${1}
      ${15}   | ${1} | ${10} | ${10}
      ${0.05} | ${1} | ${10} | ${1}
    `('adjusts $qty to $expected (min=$min, max=$max)', ({ qty, min, max, expected }) => {
      expect(applyAmountLimits(qty, { amount: { min, max } })).toBe(expected);
    });

    it('returns original for non-positive quantity', () => {
      expect(applyAmountLimits(-1, { amount: { min: 1 } })).toBe(-1);
    });

    it('handles missing limits', () => {
      expect(applyAmountLimits(5, {})).toBe(5);
    });
  });

  describe('applyCostLimits', () => {
    it.each`
      qty     | minPrice | maxPrice | minCost | maxCost | expected
      ${1}    | ${100}   | ${100}   | ${10}   | ${200}  | ${1}
      ${0.05} | ${100}   | ${100}   | ${10}   | ${200}  | ${0.1}
      ${3}    | ${100}   | ${100}   | ${10}   | ${200}  | ${2}
    `('adjusts $qty to $expected', ({ qty, minPrice, maxPrice, minCost, maxCost, expected }) => {
      expect(applyCostLimits(qty, minPrice, maxPrice, { cost: { min: minCost, max: maxCost } })).toBe(expected);
    });

    it('returns original for non-positive quantity', () => {
      expect(applyCostLimits(-1, 100, 100, { cost: { min: 10 } })).toBe(-1);
    });

    it('handles missing limits', () => {
      expect(applyCostLimits(5, 100, 100, {})).toBe(5);
    });
  });

  describe('computeRebalancePlan', () => {
    const marketData: MarketData = { precision: { amount: 0.01 } };

    it('returns BUY plan when asset value is low for symmetric levels', () => {
      // 5 buy + 5 sell = target 50% asset (500 value = 5 asset at price 100)
      // totalAssetValue = 0, totalCurrencyValue = 1000
      const plan = computeRebalancePlan(100, 0, 1000, 5, 5, marketData);

      expect(plan?.side).toBe('BUY');
    });

    it('returns SELL plan when asset value is high', () => {
      // 5 buy + 5 sell = target 50% asset (500 value) but we have 1000 value in asset
      // totalAssetValue = 10, totalCurrencyValue = 0
      const plan = computeRebalancePlan(100, 10, 0, 5, 5, marketData);

      expect(plan?.side).toBe('SELL');
    });

    it('returns null for balanced portfolio with symmetric levels', () => {
      // 5 buy + 5 sell = target 50% asset = 500 value, we have 5*100=500
      // totalAssetValue = 5, totalCurrencyValue = 500
      expect(computeRebalancePlan(100, 5, 500, 5, 5, marketData)).toBeNull();
    });

    it('computes correct ratio for asymmetric levels', () => {
      // 2 buy + 8 sell = target 80% asset (800 value = 8 asset at price 100)
      // totalAssetValue = 0, totalCurrencyValue = 1000
      const plan = computeRebalancePlan(100, 0, 1000, 2, 8, marketData);

      expect(plan?.amount).toBe(8); // Need to buy 8 asset to reach 800 value
    });

    it('returns null for zero center price', () => {
      expect(computeRebalancePlan(0, 0, 1000, 5, 5, marketData)).toBeNull();
    });

    it('returns null for zero levels', () => {
      expect(computeRebalancePlan(100, 5, 500, 0, 0, marketData)).toBeNull();
    });

    it('returns null for empty portfolio', () => {
      expect(computeRebalancePlan(100, 0, 0, 5, 5, marketData)).toBeNull();
    });

    it('applies amount limits', () => {
      const marketDataWithMax: MarketData = { amount: { max: 10 }, precision: { amount: 0.01 } };
      // totalAssetValue = 0, totalCurrencyValue = 10000
      const plan = computeRebalancePlan(100, 0, 10000, 5, 5, marketDataWithMax);

      expect(plan?.amount).toBe(10);
    });
  });

  describe('deriveLevelQuantity', () => {
    // assetFree = 10, currencyFree = 1000
    const marketData: MarketData = { precision: { amount: 0.01 } };

    it('derives quantity from portfolio for symmetric levels', () => {
      // deriveLevelQuantity(centerPrice, assetFree, currencyFree, buyLevels, sellLevels, priceDecimals, spacingType, spacingValue, marketData, priceStep?)
      const qty = deriveLevelQuantity(100, 10, 1000, 2, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBeGreaterThan(0);
    });

    it('derives quantity from portfolio for asymmetric levels', () => {
      const qty = deriveLevelQuantity(100, 10, 1000, 3, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBeGreaterThan(0);
    });

    it('returns 0 for zero levels', () => {
      expect(deriveLevelQuantity(100, 10, 1000, 0, 0, 2, 'fixed', 5, marketData)).toBe(0);
    });

    it('handles only buy levels', () => {
      const qty = deriveLevelQuantity(100, 10, 1000, 2, 0, 2, 'fixed', 5, marketData);

      expect(qty).toBeGreaterThan(0);
    });

    it('handles only sell levels', () => {
      const qty = deriveLevelQuantity(100, 10, 1000, 0, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBe(5);
    });

    it('applies amount limits', () => {
      const marketDataWithLimits: MarketData = { amount: { min: 0.1, max: 1 }, precision: { amount: 0.01 } };
      const qty = deriveLevelQuantity(100, 10, 1000, 2, 2, 2, 'fixed', 5, marketDataWithLimits);

      expect(qty).toBeLessThanOrEqual(1);
    });

    it('applies cost limits when bounds exist', () => {
      const marketDataWithCostLimits: MarketData = {
        cost: { min: 10, max: 1000 },
        precision: { amount: 0.01 },
      };
      const qty = deriveLevelQuantity(100, 10, 1000, 2, 2, 2, 'fixed', 5, marketDataWithCostLimits);

      expect(qty).toBeGreaterThan(0);
    });

    it('returns 0 for insufficient portfolio', () => {
      // assetFree = 0, currencyFree = 0
      const qty = deriveLevelQuantity(100, 0, 0, 2, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBe(0);
    });

    it('handles price step parameter', () => {
      const qty = deriveLevelQuantity(100, 10, 1000, 2, 2, 2, 'fixed', 5, marketData, 0.5);

      expect(qty).toBeGreaterThan(0);
    });

    it('handles negative level prices in calculation', () => {
      // Low center price where some buy levels would be negative - should skip those
      const qty = deriveLevelQuantity(10, 10, 1000, 5, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBeGreaterThanOrEqual(0);
    });
  });

  describe('hasOnlyOneSide', () => {
    it('returns true for only BUY orders', () => {
      const levels = [
        { side: 'BUY' as const, orderId: '1' },
        { side: 'BUY' as const, orderId: '2' },
      ];

      expect(hasOnlyOneSide(levels)).toBe(true);
    });

    it('returns true for only SELL orders', () => {
      const levels = [
        { side: 'SELL' as const, orderId: '1' },
        { side: 'SELL' as const, orderId: '2' },
      ];

      expect(hasOnlyOneSide(levels)).toBe(true);
    });

    it('returns false for both sides', () => {
      const levels = [
        { side: 'BUY' as const, orderId: '1' },
        { side: 'SELL' as const, orderId: '2' },
      ];

      expect(hasOnlyOneSide(levels)).toBe(false);
    });

    it('ignores levels without orders', () => {
      const levels = [
        { side: 'BUY' as const, orderId: '1' },
        { side: 'SELL' as const, orderId: undefined },
      ];

      expect(hasOnlyOneSide(levels)).toBe(true);
    });

    it('returns false for empty levels', () => {
      expect(hasOnlyOneSide([])).toBe(false);
    });
  });

  // GridBot used to place again an order whatever its error. The event carries no field saying that the order may be live: the
  // reason, as the order layer and CCXTExchange word it, is read
  describe('isOutcomeUnknown', () => {
    it.each`
      reason                                                                                                                                                             | source                                                          | expected
      ${'Outcome unknown: the order may be live on the exchange, check it before placing it again ([EXCHANGE] binance 504 Gateway Time-out)'}                            | ${'a creation lost on the network'}                             | ${true}
      ${'[EXCHANGE] binance answered the creation of an order on BTC/USDT with neither a status nor an id: the order may exist on the exchange, but cannot be followed'} | ${'a creation answered with neither a status nor an id'}        | ${true}
      ${'[EXCHANGE] Insufficient currency balance (portfolio: 60, order cost: 190)'}                                                                                     | ${'a refusal of the simulated exchange'}                        | ${false}
      ${'[EXCHANGE] binance {"code":-2010,"msg":"Account has insufficient balance for requested action."}'}                                                              | ${'a refusal of a real exchange'}                               | ${false}
      ${new OrderOutOfRangeError('exchange', 'amount', 0.001, 0.01).message}                                                                                             | ${'an amount out of the limits of the market'}                  | ${false}
      ${'no price known for BTC/USDT'}                                                                                                                                   | ${'an order the Trader could not place'}                        | ${false}
      ${'[EXCHANGE] binance {"code":-2013,"msg":"Order does not exist."}'}                                                                                               | ${'a poll that failed for good, worded by the exchange itself'} | ${false}
    `('is $expected for $source', ({ reason, expected }) => {
      expect(isOutcomeUnknown(reason)).toBe(expected);
    });

    describe('on the reason of a real LIMIT order', () => {
      beforeEach(() => {
        fakeExchange.createLimitOrder.mockRejectedValue(new ExchangeNetworkError('binance POST /api/v3/order 504 Gateway Time-out'));
      });

      it('is true once its creation is lost on the network', async () => {
        const order = new LimitOrder('BTC/USDT', randomUUID(), 'BUY', 1, 95);
        const reason = new Promise<string>(resolve => order.once(ORDER_ERRORED_EVENT, resolve));
        await order.launch();

        expect(isOutcomeUnknown(await reason)).toBe(true);
      });
    });
  });
});
