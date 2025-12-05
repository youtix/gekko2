import type { Portfolio } from '@models/portfolio.types';
import type { MarketData } from '@services/exchange/exchange.types';
import { describe, expect, it, vi } from 'vitest';
import type { GridRange, LevelState, RebalancePlan } from './gridBot.types';
import {
  applyAmountLimits,
  applyCostLimits,
  buildLevelIndexes,
  computeAffordableLevels,
  computeLevelPrice,
  computeRebalancePlan,
  countDecimals,
  estimatePriceRange,
  inferPricePrecision,
  isGridOutOfRange,
  isOnlyOneSideRemaining,
  resolveLevelQuantity,
  resolveOrderCap,
  roundPrice,
  validateRebalancePlan,
} from './gridBot.utils';

describe('gridBot.utils', () => {
  describe('isGridOutOfRange', () => {
    it.each([
      { currentPrice: 90, min: 100, max: 200, expected: true },
      { currentPrice: 210, min: 100, max: 200, expected: true },
      { currentPrice: 150, min: 100, max: 200, expected: false },
      { currentPrice: 100, min: 100, max: 200, expected: false },
      { currentPrice: 200, min: 100, max: 200, expected: false },
    ])(
      'returns $expected when price is $currentPrice for range [$min, $max]',
      ({ currentPrice, min, max, expected }) => {
        expect(isGridOutOfRange(currentPrice, { min, max } as GridRange)).toBe(expected);
      },
    );
  });

  describe('isOnlyOneSideRemaining', () => {
    it('returns true if only BUY orders remain', () => {
      const levels = new Map<number, LevelState>([
        [1, { activeOrderId: '1', desiredSide: 'BUY' } as any],
        [2, { activeOrderId: '2', desiredSide: 'BUY' } as any],
      ]);
      expect(isOnlyOneSideRemaining(levels)).toBe(true);
    });

    it('returns true if only SELL orders remain', () => {
      const levels = new Map<number, LevelState>([
        [-1, { activeOrderId: '1', desiredSide: 'SELL' } as any],
        [-2, { activeOrderId: '2', desiredSide: 'SELL' } as any],
      ]);
      expect(isOnlyOneSideRemaining(levels)).toBe(true);
    });

    it('returns false if both sides have orders', () => {
      const levels = new Map<number, LevelState>([
        [1, { activeOrderId: '1', desiredSide: 'BUY' } as any],
        [-1, { activeOrderId: '2', desiredSide: 'SELL' } as any],
      ]);
      expect(isOnlyOneSideRemaining(levels)).toBe(false);
    });

    it('ignores levels without active orders', () => {
      const levels = new Map<number, LevelState>([
        [1, { activeOrderId: '1', desiredSide: 'BUY' } as any],
        [-1, { desiredSide: 'SELL' } as any], // No active order
      ]);
      expect(isOnlyOneSideRemaining(levels)).toBe(true);
    });
  });

  describe('resolveOrderCap', () => {
    it.each([
      { override: undefined, expected: 50 },
      { override: 0, expected: 50 },
      { override: -5, expected: 50 },
      { override: 1, expected: 2 },
      { override: 10, expected: 10 },
      { override: 100, expected: 50 },
    ])('resolves to $expected when override is $override', ({ override, expected }) => {
      expect(resolveOrderCap(override)).toBe(expected);
    });
  });

  describe('countDecimals', () => {
    it.each([
      { num: 100, expected: 0 },
      { num: 100.5, expected: 1 },
      { num: 100.55, expected: 2 },
      { num: 1e-7, expected: 7 },
      { num: 1.5e-3, expected: 4 },
    ])('counts $expected decimals for $num', ({ num, expected }) => {
      expect(countDecimals(num)).toBe(expected);
    });
  });

  describe('roundPrice', () => {
    it.each([
      { value: 100.123, priceDecimals: 2, priceStep: undefined, expected: 100.12 },
      { value: 100.126, priceDecimals: 2, priceStep: undefined, expected: 100.13 },
      { value: 100.123, priceDecimals: 2, priceStep: 0.05, expected: 100.1 },
      { value: 100.13, priceDecimals: 2, priceStep: 0.05, expected: 100.15 },
      { value: Infinity, priceDecimals: 2, priceStep: undefined, expected: 0 },
    ])(
      'rounds $value to $expected with decimals $priceDecimals and step $priceStep',
      ({ value, priceDecimals, priceStep, expected }) => {
        expect(roundPrice(value, priceDecimals, priceStep)).toBe(expected);
      },
    );
  });

  describe('computeLevelPrice', () => {
    const center = 100;
    const decimals = 2;

    it.each([
      { index: 0, type: 'fixed', value: 5, expected: 100 },
      { index: 1, type: 'fixed', value: 5, expected: 105 },
      { index: -1, type: 'fixed', value: 5, expected: 95 },
      { index: 2, type: 'fixed', value: 5, expected: 110 },
      { index: 1, type: 'percent', value: 5, expected: 105 },
      { index: -1, type: 'percent', value: 5, expected: 95 },
      { index: 1, type: 'geometric', value: 0.1, expected: 110 },
      { index: -1, type: 'geometric', value: 0.1, expected: 90.91 },
    ])('computes price $expected for index $index with $type spacing of $value', ({ index, type, value, expected }) => {
      expect(computeLevelPrice(center, index, decimals, type as any, value)).toBe(expected);
    });
  });

  describe('estimatePriceRange', () => {
    it('returns min/max for valid inputs', () => {
      const result = estimatePriceRange(100, 2, 2, 'fixed', 5);
      expect(result).toEqual({ min: 90, max: 110 });
    });

    it('returns null for invalid levels', () => {
      expect(estimatePriceRange(100, 0, 2, 'fixed', 5)).toBeNull();
    });

    it('returns null for invalid prices', () => {
      // Force a case where price calculation might fail or be negative if not handled, though computeLevelPrice handles it.
      // Here we test if computeLevelPrice returns <= 0
      expect(estimatePriceRange(10, 5, 2, 'fixed', 5)).toBeNull(); // 10 - 25 = -15 -> null
    });
  });

  describe('buildLevelIndexes', () => {
    it('generates indexes from -N to N', () => {
      expect(buildLevelIndexes(2)).toEqual([-2, -1, 0, 1, 2]);
    });
  });

  describe('resolveLevelQuantity', () => {
    const portfolio: Portfolio = { asset: 10, currency: 1000 };
    const marketData: MarketData = { amount: { min: 0.1 } };

    it('uses override if provided', () => {
      expect(resolveLevelQuantity(100, portfolio, 2, marketData, 5)).toBe(5);
    });

    it('calculates quantity based on portfolio and levels', () => {
      // 2 levels per side.
      // Asset share: 10 / 2 = 5
      // Currency share: 1000 / (2 * 100) = 5
      // Min is 5
      expect(resolveLevelQuantity(100, portfolio, 2, marketData)).toBe(5);
    });

    it('respects amount rounding', () => {
      // Asset share: 10/2 = 5
      // Currency share: 1000 / (2*100) = 5
      // But let's make currency share smaller: 1000 / (2*200) = 2.5
      expect(resolveLevelQuantity(200, portfolio, 2, marketData)).toBe(2.5);
    });

    it('returns 0 if levelsPerSide is 0', () => {
      expect(resolveLevelQuantity(100, portfolio, 0, marketData)).toBe(0);
    });
  });

  describe('applyAmountLimits', () => {
    it.each([
      { qty: 5, min: 1, max: 10, expected: 5 },
      { qty: 0.5, min: 1, max: 10, expected: 1 },
      { qty: 15, min: 1, max: 10, expected: 10 },
      { qty: -1, min: 1, max: 10, expected: -1 },
    ])('adjusts $qty to $expected within [$min, $max]', ({ qty, min, max, expected }) => {
      expect(applyAmountLimits(qty, { amount: { min, max } })).toBe(expected);
    });
  });

  describe('applyCostLimits', () => {
    it.each([
      { qty: 1, minPrice: 100, maxPrice: 100, minCost: 10, maxCost: 200, expected: 1 },
      { qty: 0.05, minPrice: 100, maxPrice: 100, minCost: 10, maxCost: 200, expected: 0.1 },
      { qty: 3, minPrice: 100, maxPrice: 100, minCost: 10, maxCost: 200, expected: 2 },
    ])(
      'adjusts $qty to $expected for cost limits [$minCost, $maxCost]',
      ({ qty, minPrice, maxPrice, minCost, maxCost, expected }) => {
        expect(applyCostLimits(qty, minPrice, maxPrice, { cost: { min: minCost, max: maxCost } })).toBe(expected);
      },
    );
  });

  describe('computeAffordableLevels', () => {
    const portfolio: Portfolio = { asset: 10, currency: 1000 };

    it('returns maxLevels if affordable', () => {
      // Price ~100. Qty 1.
      // Max buys: 1000 / (1 * ~100) = 10
      // Max sells: 10 / 1 = 10
      // Request 5.
      expect(computeAffordableLevels(100, portfolio, 1, 5, 2, 'fixed', 5)).toBe(5);
    });

    it('limits by currency', () => {
      // Price ~100. Qty 1.
      // Max buys: 100 / (1 * ~100) = 1
      const poorPortfolio = { ...portfolio, currency: 100 };
      expect(computeAffordableLevels(100, poorPortfolio, 1, 5, 2, 'fixed', 5)).toBe(1);
    });

    it('limits by asset', () => {
      // Max sells: 2 / 1 = 2
      const lowAssetPortfolio = { ...portfolio, asset: 2 };
      expect(computeAffordableLevels(100, lowAssetPortfolio, 1, 5, 2, 'fixed', 5)).toBe(2);
    });
  });

  describe('validateRebalancePlan', () => {
    const tools: any = { log: vi.fn(), marketData: { amount: { min: 0.1, max: 100 }, cost: { min: 1, max: 1000 } } };
    const portfolio: Portfolio = { asset: 10, currency: 1000 };
    const basePlan: RebalancePlan = {
      stage: 'init',
      side: 'BUY',
      amount: 1,
      centerPrice: 100,
      driftPercent: 5,
      tolerancePercent: 1,
      targetValuePerSide: 500,
      currentAssetValue: 0,
      currentCurrencyValue: 1000,
      estimatedNotional: 100,
    };

    it('validates a correct plan', () => {
      expect(validateRebalancePlan(basePlan, portfolio, tools)).toBe(true);
    });

    it('fails if amount is invalid', () => {
      expect(validateRebalancePlan({ ...basePlan, amount: 0 }, portfolio, tools)).toBe(false);
    });

    it('fails if insufficient asset for SELL', () => {
      expect(validateRebalancePlan({ ...basePlan, side: 'SELL', amount: 20 }, portfolio, tools)).toBe(false);
      expect(tools.log).toHaveBeenCalledWith('warn', expect.stringContaining('insufficient asset'));
    });

    it('fails if insufficient currency for BUY', () => {
      expect(validateRebalancePlan({ ...basePlan, side: 'BUY', estimatedNotional: 2000 }, portfolio, tools)).toBe(
        false,
      );
      expect(tools.log).toHaveBeenCalledWith('warn', expect.stringContaining('insufficient currency'));
    });

    it('fails if amount below min', () => {
      expect(validateRebalancePlan({ ...basePlan, amount: 0.01 }, portfolio, tools)).toBe(false);
    });
  });

  describe('inferPricePrecision', () => {
    it('infers from price step if present', () => {
      expect(inferPricePrecision(123.45, { precision: { price: 0.5 } })).toEqual({ priceDecimals: 1, priceStep: 0.5 });
    });

    it('infers from current price if no step', () => {
      expect(inferPricePrecision(123.456, {})).toEqual({ priceDecimals: 3 });
    });
  });

  describe('computeRebalancePlan', () => {
    const portfolio: Portfolio = { asset: 0, currency: 1000 }; // Total 1000. Target 500 each.
    const marketData: MarketData = {};

    it('returns plan when drift exceeds tolerance', () => {
      // Price 100. Asset 0 -> 0 value. Currency 1000.
      // Gap: 500 - 0 = 500.
      // Drift: 500 / 1000 = 50%
      const plan = computeRebalancePlan('init', 100, portfolio, marketData, 5);
      expect(plan).toMatchObject({
        side: 'BUY',
        amount: 5, // 500 / 100
        driftPercent: 50,
      });
    });

    it('returns null when drift is within tolerance', () => {
      // Portfolio balanced: 5 asset * 100 = 500. Currency 500.
      const balancedPortfolio = { asset: 5, currency: 500 };
      expect(computeRebalancePlan('init', 100, balancedPortfolio, marketData, 5)).toBeNull();
    });

    it('rounds amount according to market data', () => {
      const portfolio = { asset: 0, currency: 1000 };
      // Gap 500. Price 100. Raw amount 5.
      // Let's use a price that gives a long decimal amount.
      // Price 33. Gap 500. Amount 15.151515...
      const marketDataWithPrecision: MarketData = { amount: { min: 0.1 }, precision: { amount: 0.1 } };
      // If we assume default rounding is used if not specified, or we can specify a step.
      // Let's specify a step indirectly via min or just rely on the fact that it SHOULD round.
      // Actually resolveLevelQuantity uses countDecimals(marketData.amount?.min ?? DEFAULT_AMOUNT_ROUNDING).

      const plan = computeRebalancePlan('init', 33, portfolio, marketDataWithPrecision, 1);
      // 15.1515... should be rounded to 1 decimal place (0.1 step) -> 15.1
      expect(plan?.amount).toBe(15.1);
    });

    it('applies min/max limits to amount', () => {
      const portfolio = { asset: 0, currency: 10000 };
      // Price 100. Gap 5000. Amount 50.
      // Max limit 10.
      const marketDataWithMaxAmount: MarketData = { amount: { min: 0.1, max: 10 } };

      const plan = computeRebalancePlan('init', 100, portfolio, marketDataWithMaxAmount, 1);
      expect(plan?.amount).toBe(10);
    });
  });
});
