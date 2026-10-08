import { ORDER_ERRORED_EVENT } from '@constants/event.const';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { LimitOrder } from '@services/core/order/limit/limitOrder';
import { ExchangeNetworkError } from '@services/exchange/exchange.error';
import { MarketData } from '@services/exchange/exchange.types';
import { omit } from 'lodash-es';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridBot } from './gridBot.strategy';
import { GridBotStrategyParams, GridBounds, GridSpacingType } from './gridBot.types';
import {
  checkPriceTick,
  checkRoundTripFee,
  computeGridBounds,
  computeGridPrices,
  computeLevelPrice,
  computeRebalancePlan,
  countDecimals,
  deriveLevelQuantity,
  getMakerFee,
  getMaximumAmount,
  getMinimumAmount,
  getRebalanceBuyCost,
  getRebalanceOrderPrice,
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

// The documented dummy-cex block (config/backtest.yml), its 8 decimals handed on as steps by its schema, and a market charging a
// 0.1 % maker fee, as Binance does
const documentedMarketData: MarketData = {
  price: { min: 0.01, max: 1_000_000 },
  amount: { min: 0.00001, max: 9000 },
  cost: { min: 5, max: 9_000_000 },
  precision: { price: 1e-8, amount: 1e-8 },
  fee: { maker: 0.0004, taker: 0.0007 },
};
const tenthPercentFeeMarketData: MarketData = {
  price: { min: 0.01 },
  amount: { min: 0.00001 },
  cost: { min: 5 },
  precision: { price: 0.01, amount: 0.00001 },
  fee: { maker: 0.001, taker: 0.001 },
};
// The documented block with Binance's BTC/USDT steps, an amount to 5 decimals and a price to the cent, which CCXTExchange truncates an
// amount to
const binanceStepsMarketData: MarketData = { ...documentedMarketData, precision: { price: 0.01, amount: 0.00001 } };

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

  describe('computeGridPrices', () => {
    it.each`
      buyLevels | sellLevels | spacingType  | spacingValue | description                                            | expected
      ${2}      | ${2}       | ${'fixed'}   | ${5}         | ${'a 2/2 grid'}                                        | ${[90, 95, 100, 105, 110]}
      ${2}      | ${0}       | ${'fixed'}   | ${5}         | ${'a grid of buy levels only, up to the center price'} | ${[90, 95, 100]}
      ${0}      | ${2}       | ${'fixed'}   | ${5}         | ${'a grid of sell levels only, from the center price'} | ${[100, 105, 110]}
      ${3}      | ${3}       | ${'percent'} | ${0.001}     | ${'a 3/3 grid spaced by 0.001 %, rounded to the cent'} | ${[100, 100, 100, 100, 100, 100, 100]}
    `('are $expected for $description around 100', ({ buyLevels, sellLevels, spacingType, spacingValue, expected }) => {
      expect(computeGridPrices(100, { buyLevels, sellLevels, spacingType, spacingValue }, 2, 0.01)).toEqual(expected);
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

    // A spacing under the tick used to be accepted, the prices of the grid rounded onto each other: percent 0.001 at 100 put every
    // price of a 3/3 grid at 100, where its levels bought and sold at zero spread, two fees a round trip for nothing
    it.each`
      center    | buyLevels | sellLevels | spacingType      | spacingValue | tick      | description                                                     | price
      ${100}    | ${3}      | ${3}       | ${'percent'}     | ${0.001}     | ${0.01}   | ${'every price of the grid at the center price'}                | ${100}
      ${100}    | ${2}      | ${2}       | ${'fixed'}       | ${0.004}     | ${0.01}   | ${'the prices next to the center price at the center price'}    | ${100}
      ${100}    | ${1}      | ${1}       | ${'logarithmic'} | ${0.00004}   | ${0.01}   | ${'a logarithmic spacing under the tick'}                       | ${100}
      ${100}    | ${3}      | ${3}       | ${'fixed'}       | ${0.008}     | ${0.01}   | ${'the farthest prices only, 0.016 and 0.024 below the center'} | ${99.98}
      ${0.0123} | ${5}      | ${5}       | ${'percent'}     | ${0.5}       | ${0.0001} | ${'a coin whose tick is 0.8 % of its price, duplicated levels'} | ${0.0121}
      ${10.25}  | ${2}      | ${2}       | ${'percent'}     | ${1}         | ${0.25}   | ${'a tick of 0.25, not one unit of a decimal'}                  | ${10.25}
      ${100}    | ${1}      | ${0}       | ${'fixed'}       | ${0.004}     | ${0.01}   | ${'one buy level, which sells at the center price'}             | ${100}
      ${100}    | ${0}      | ${1}       | ${'fixed'}       | ${0.004}     | ${0.01}   | ${'one sell level, which buys at the center price'}             | ${100}
    `(
      'returns error naming the parameter and the tick for two adjacent prices rounded to the same tick: $description',
      ({ center, buyLevels, sellLevels, spacingType, spacingValue, tick, price }) => {
        expect(
          validateConfig({ ...validParams, buyLevels, sellLevels, spacingType, spacingValue }, center, { precision: { price: tick } }),
        ).toBe(
          `Grid configuration would result in a level buying and selling at the same price: spaced by spacingValue ${spacingValue} (${spacingType}) around the center price ${center}, two adjacent prices of the grid would both round to ${price} at the price tick ${tick}`,
        );
      },
    );

    // 0.008 below and above 100 round to 99.99 and 100.01: the grid is a tick apart, as rounded, not a level at zero spread
    it.each`
      spacingValue | description
      ${0.01}      | ${'exactly one tick'}
      ${0.008}     | ${'under one tick, the 2/2 grid rounded a tick apart'}
    `('returns null for a fixed spacing of $spacingValue at 100 on a tick of 0.01: $description', ({ spacingValue }) => {
      expect(validateConfig({ ...validParams, spacingValue }, 100, { precision: { price: 0.01 } })).toBeNull();
    });

    it('returns error for price below exchange minimum', () => {
      expect(validateConfig({ ...validParams, buyLevels: 0 }, 0.5, { price: { min: 1 } })).toBe(
        'Center price 0.5 is below exchange minimum 1',
      );
    });

    it('returns error for price above exchange maximum', () => {
      expect(validateConfig(validParams, 1000, { price: { max: 500 } })).toBe('Center price 1000 is above exchange maximum 500');
    });

    // Checked last, the tick leaves every configuration refused before refused with the same message
    it('returns error for price below exchange minimum before the one of a grid spaced under the tick', () => {
      const underTick = { ...validParams, spacingType: 'percent' as const, spacingValue: 0.001 };

      expect(validateConfig(underTick, 0.5, { price: { min: 1 }, precision: { price: 0.01 } })).toBe(
        'Center price 0.5 is below exchange minimum 1',
      );
    });
  });

  // A percent or logarithmic step shrinks with the price: 0.0084 % keeps the prices of a 3/3 grid a tick apart at 100, not at 99. A
  // fixed step does not, the center price being on the tick
  describe('checkPriceTick', () => {
    const nearTheTick = { buyLevels: 3, sellLevels: 3, spacingValue: 0.0084 };

    it.each`
      center | spacingType  | description
      ${100} | ${'percent'} | ${'percent 0.0084 at 100: 99.97, 99.98, 99.99, 100, 100.01, 100.02 and 100.03'}
      ${99}  | ${'fixed'}   | ${'fixed 0.0084 at 99: 98.97, 98.98, 98.99, 99, 99.01, 99.02 and 99.03'}
    `('is null for $description', ({ center, spacingType }) => {
      expect(checkPriceTick({ ...nearTheTick, spacingType }, center, 2, 0.01)).toBeNull();
    });

    it('is the error of percent 0.0084 at 99, whose prices round to 98.98 twice', () => {
      expect(checkPriceTick({ ...nearTheTick, spacingType: 'percent' }, 99, 2, 0.01)).toBe(
        'Grid configuration would result in a level buying and selling at the same price: spaced by spacingValue 0.0084 (percent) around the center price 99, two adjacent prices of the grid would both round to 98.98 at the price tick 0.01',
      );
    });
  });

  // A spacing under the round-trip fee used to be accepted without a word: every round trip of a level paid more in fees than it
  // earned, and the more the grid traded, the more it lost
  describe('checkRoundTripFee', () => {
    const fivePerSide = { buyLevels: 5, sellLevels: 5, retryOnError: 3 };
    /** The warning, from what it names: the round trip's break-even, the fee, the levels under it and the narrowest of them */
    const underFee = (spacing: string, breakEven: string, fee: number, count: string, narrowest: string) =>
      `spacingValue ${spacing} is under the round-trip fee: a level that sells less than ${breakEven} above its buy, paying the maker fee of ${fee} (fee.maker) on its BUY and on its SELL, loses money at each round trip, ${count} here, the narrowest ${narrowest}`;

    // A maker fee of 0.0004 costs a round trip 0.08003 % of the price, 0.1 % costs 0.2002 %: 2 × fee / (1 - fee)
    it.each`
      center   | spacingType      | spacingValue | maker     | description                                           | breakEven      | count             | narrowest
      ${60000} | ${'fixed'}       | ${10}        | ${0.0004} | ${'fixed 10 at 60000, 0.0167 % a level'}              | ${'0.08003 %'} | ${'10 out of 10'} | ${'selling at 60050, 0.01666 % above its buy at 60040'}
      ${60000} | ${'percent'}     | ${0.05}      | ${0.0004} | ${'percent 0.05'}                                     | ${'0.08003 %'} | ${'10 out of 10'} | ${'selling at 60150, 0.0499 % above its buy at 60120'}
      ${60000} | ${'logarithmic'} | ${0.0005}    | ${0.0004} | ${'logarithmic 0.0005'}                               | ${'0.08003 %'} | ${'10 out of 10'} | ${'selling at 59940.04, 0.04999 % above its buy at 59910.09'}
      ${60000} | ${'fixed'}       | ${100}       | ${0.001}  | ${'the documentation example of fixed 100, at 0.1 %'} | ${'0.2002 %'}  | ${'10 out of 10'} | ${'selling at 60500, 0.1656 % above its buy at 60400'}
      ${60000} | ${'fixed'}       | ${48}        | ${0.0004} | ${'fixed 48, under the fee above the center only'}    | ${'0.08003 %'} | ${'5 out of 10'}  | ${'selling at 60240, 0.07974 % above its buy at 60192'}
      ${100}   | ${'percent'}     | ${0.08}      | ${0.0004} | ${'percent 0.08, a hair under the fee above 100'}     | ${'0.08003 %'} | ${'5 out of 10'}  | ${'selling at 100.4, 0.07974 % above its buy at 100.32'}
      ${100}   | ${'fixed'}       | ${0.01}      | ${0.0004} | ${'fixed 0.01 at 100, one tick'}                      | ${'0.08003 %'} | ${'10 out of 10'} | ${'selling at 100.05, 0.009996 % above its buy at 100.04'}
    `(
      'warns of $description, naming the parameter, the fee and the narrowest level',
      ({ center, spacingType, spacingValue, maker, breakEven, count, narrowest }) => {
        const marketData: MarketData = { precision: { price: 0.01 }, fee: { maker } };

        expect(checkRoundTripFee({ ...fivePerSide, spacingType, spacingValue }, center, marketData)).toBe(
          underFee(`${spacingValue} (${spacingType})`, breakEven, maker, count, narrowest),
        );
      },
    );

    it.each`
      center      | spacingType  | spacingValue | marketData                                                | description
      ${61234.56} | ${'percent'} | ${1}         | ${documentedMarketData}                                   | ${'the documentation example, 1 % a level at a maker fee of 0.0004'}
      ${100}      | ${'percent'} | ${0.09}      | ${{ precision: { price: 0.01 }, fee: { maker: 0.0004 } }} | ${'percent 0.09, over the fee by a hair: 0.08968 % for the narrowest level'}
      ${100}      | ${'fixed'}   | ${0.01}      | ${{ precision: { price: 0.01 } }}                         | ${'one tick on a market that states no fee'}
      ${100}      | ${'fixed'}   | ${0.01}      | ${{ precision: { price: 0.01 }, fee: { taker: 0.001 } }}  | ${'one tick on a market that states a taker fee only, which LIMIT orders resting in the book do not pay'}
    `('returns null for $description', ({ center, spacingType, spacingValue, marketData }) => {
      expect(checkRoundTripFee({ ...fivePerSide, spacingType, spacingValue }, center, marketData)).toBeNull();
    });
  });

  // GridBot used to raise an amount to amount.min, or to cost.min at its price, left unrounded: CCXTExchange truncated it to the
  // amount step, under cost.min again, and the exchange refused it
  describe('getMinimumAmount', () => {
    it.each`
      price       | marketData                                                                       | description                                                                          | expected
      ${100}      | ${{ precision: { amount: 0.01 } }}                                               | ${'no limit: one amount step'}                                                       | ${0.01}
      ${100}      | ${{}}                                                                            | ${'no limit and no precision: one step of 8 decimals'}                               | ${1e-8}
      ${100}      | ${{ amount: { min: 0, max: 0 }, cost: { min: 0 }, precision: { amount: 0.01 } }} | ${'limits of 0, which bound nothing: one amount step'}                               | ${0.01}
      ${100}      | ${{ amount: { min: 0.1 }, precision: { amount: 0.01 } }}                         | ${'amount.min'}                                                                      | ${0.1}
      ${100}      | ${{ amount: { min: 0.015 }, precision: { amount: 0.01 } }}                       | ${'amount.min off the amount step, rounded up to it'}                                | ${0.02}
      ${58172.83} | ${{ cost: { min: 5 }, precision: { amount: 0.00001 } }}                          | ${'cost.min / price, 0.0000859507…, rounded up to the amount step'}                  | ${0.00009}
      ${58172.83} | ${{ amount: { min: 0.0001 }, cost: { min: 5 }, precision: { amount: 0.00001 } }} | ${'the larger of amount.min and cost.min / price'}                                   | ${0.0001}
      ${50000}    | ${{ cost: { min: 5 }, precision: { amount: 1e-8 } }}                             | ${'cost.min / price exactly, 0.0001 × 50000 being 5 in floating point'}              | ${0.0001}
      ${100000}   | ${{ cost: { min: 7 }, precision: { amount: 1e-8 } }}                             | ${'cost.min / price exactly, 0.00007 × 100000 being 6.999999999999999: a step more'} | ${0.00007001}
    `('is $expected for $description', ({ price, marketData, expected }) => {
      expect(getMinimumAmount(price, marketData)).toBe(expected);
    });

    // As the simulator and CCXTExchange compute the cost of an order, amount × price, against cost.min
    it.each`
      price        | marketData
      ${58172.83}  | ${binanceStepsMarketData}
      ${61234.57}  | ${documentedMarketData}
      ${100000}    | ${{ cost: { min: 7 }, precision: { amount: 1e-8 } }}
      ${800000}    | ${{ cost: { min: 7 }, precision: { amount: 1e-8 } }}
      ${0.0001234} | ${{ cost: { min: 5 }, precision: { amount: 1 } }}
    `('is an amount whose cost at $price is cost.min or more', ({ price, marketData }) => {
      expect(getMinimumAmount(price, marketData) * price).toBeGreaterThanOrEqual(marketData.cost.min);
    });
  });

  describe('getMaximumAmount', () => {
    it.each`
      price     | marketData                                                                  | description                                                                           | expected
      ${100}    | ${{ precision: { amount: 0.01 } }}                                          | ${'no limit'}                                                                         | ${Infinity}
      ${100}    | ${{ amount: { max: 0 }, cost: { max: 0 } }}                                 | ${'limits of 0, which bound nothing'}                                                 | ${Infinity}
      ${100}    | ${{ amount: { max: 10 }, precision: { amount: 0.01 } }}                     | ${'amount.max'}                                                                       | ${10}
      ${300}    | ${{ cost: { max: 1000 }, precision: { amount: 0.01 } }}                     | ${'cost.max / price, 3.333…, rounded down to the amount step'}                        | ${3.33}
      ${300}    | ${{ amount: { max: 3 }, cost: { max: 1000 }, precision: { amount: 0.01 } }} | ${'the smaller of amount.max and cost.max / price'}                                   | ${3}
      ${300000} | ${{ cost: { max: 3 }, precision: { amount: 1e-8 } }}                        | ${'cost.max / price exactly, 0.00001 × 300000 being 3.0000000000000004: a step less'} | ${0.00000999}
    `('is $expected for $description', ({ price, marketData, expected }) => {
      expect(getMaximumAmount(price, marketData)).toBe(expected);
    });
  });

  // StickyOrder places a BUY one minimum price above the bid, a SELL one below the ask
  describe('getRebalanceOrderPrice', () => {
    it.each`
      side      | marketData                  | description                  | expected
      ${'BUY'}  | ${{ price: { min: 0.01 } }} | ${'a minimum price of 0.01'} | ${100.01}
      ${'SELL'} | ${{ price: { min: 0.01 } }} | ${'a minimum price of 0.01'} | ${99.99}
      ${'BUY'}  | ${{}}                       | ${'no minimum price'}        | ${100}
      ${'SELL'} | ${{}}                       | ${'no minimum price'}        | ${100}
    `('is $expected for a $side planned at 100, on a market with $description', ({ side, marketData, expected }) => {
      expect(getRebalanceOrderPrice(side, 100, marketData)).toBe(expected);
    });
  });

  describe('getMakerFee', () => {
    it.each`
      fee                                 | description                    | expected
      ${{ maker: 0.0004, taker: 0.0007 }} | ${'a maker fee'}               | ${0.0004}
      ${{ taker: 0.0007 }}                | ${'a taker fee, but no maker'} | ${0}
      ${undefined}                        | ${'no fee'}                    | ${0}
    `('is $expected on a market that states $description', ({ fee, expected }) => {
      expect(getMakerFee({ fee })).toBe(expected);
    });
  });

  // What the simulator reserves for a STICKY BUY: StickyOrder places it one minimum price above the bid, the maker fee on top
  describe('getRebalanceBuyCost', () => {
    it.each`
      marketData                                          | description                          | expected
      ${{ price: { min: 0.01 }, fee: { maker: 0.0004 } }} | ${'a minimum price and a maker fee'} | ${1000.50004}
      ${{ price: { min: 0.01 } }}                         | ${'a minimum price, but no fee'}     | ${1000.1}
      ${{}}                                               | ${'neither'}                         | ${1000}
    `('is $expected for 10 planned at 100, on a market that states $description', ({ marketData, expected }) => {
      expect(getRebalanceBuyCost(10, 100, marketData)).toBe(expected);
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

    // 1000 at the price of its STICKY order, 100.01, is 9.99900…: at the center price it would be 10, refused for a cost of 1000.1
    it('caps the amount at the market maximum at the price its STICKY order is placed at', () => {
      const marketDataWithMaxCost: MarketData = { cost: { max: 1000 }, price: { min: 0.01 }, precision: { amount: 0.01 } };

      expect(computeRebalancePlan(100, 0, 10000, 5, 5, marketDataWithMaxCost)?.amount).toBe(9.99);
    });

    // An amount under amount.min used to be raised to it, beyond what the gap called for and what the balances paid: 1 USDT held
    // planned a BUY of 0.1, 10 USDT. Under the market's minimum, a plan is no order to send: the strategy leaves it out
    it.each`
      center      | assetFree | currencyFree | levels | marketData                                                | description                                                          | expected
      ${100}      | ${0}      | ${1}         | ${1}   | ${{ precision: { amount: 0.001 }, amount: { min: 0.1 } }} | ${'a BUY of 0.005, under amount.min 0.1'}                            | ${0.005}
      ${61234.56} | ${0.0023} | ${150}       | ${5}   | ${documentedMarketData}                                   | ${'a BUY of 4.58 USDT, under cost.min 5, a small account 1.6 % off'} | ${0.00007479}
    `('plans $description as it is', ({ center, assetFree, currencyFree, levels, marketData, expected }) => {
      expect(computeRebalancePlan(center, assetFree, currencyFree, levels, levels, marketData)?.amount).toBe(expected);
    });

    // A sell-only grid wants the whole value in the asset: started in currency, it planned a BUY of the whole currency at the center
    // price, which the simulator refused at every attempt, its STICKY order placed one minimum price above the bid and the maker fee on
    // top, and the run stopped before any grid was built. All in currency here, the plans are BUYs.
    describe('in currency, on a market with a minimum price and a maker fee', () => {
      it.each`
        center      | buyLevels | sellLevels | marketData                         | description                                                                | expected
        ${100}      | ${0}      | ${5}       | ${documentedMarketData}            | ${'a sell-only grid'}                                                      | ${9.99500209}
        ${61234.56} | ${0}      | ${3}       | ${tenthPercentFeeMarketData}       | ${'a sell-only grid, at a 0.1 % maker fee'}                                | ${0.01631}
        ${100}      | ${5}      | ${5}       | ${documentedMarketData}            | ${'a 5/5 grid, half the currency'}                                         | ${5}
        ${100}      | ${0}      | ${5}       | ${{ precision: { amount: 1e-8 } }} | ${'a sell-only grid, on a market that states neither: the whole currency'} | ${10}
      `('plans a BUY of $expected for $description', ({ center, buyLevels, sellLevels, marketData, expected }) => {
        expect(computeRebalancePlan(center, 0, 1000, buyLevels, sellLevels, marketData)?.amount).toBe(expected);
      });

      it.each`
        center      | buyLevels | sellLevels | marketData                   | description
        ${100}      | ${0}      | ${5}       | ${documentedMarketData}      | ${'a sell-only grid'}
        ${61234.56} | ${0}      | ${3}       | ${tenthPercentFeeMarketData} | ${'a sell-only grid, at a 0.1 % maker fee'}
        ${100}      | ${5}      | ${5}       | ${documentedMarketData}      | ${'a 5/5 grid'}
      `(
        'plans a BUY the currency pays at the price of its STICKY order, the maker fee on top, for $description',
        ({ center, buyLevels, sellLevels, marketData }) => {
          const { amount } = computeRebalancePlan(center, 0, 1000, buyLevels, sellLevels, marketData)!;

          expect(amount * (center + marketData.price.min) * (1 + marketData.fee.maker)).toBeLessThanOrEqual(1000);
        },
      );
    });
  });

  describe('deriveLevelQuantity', () => {
    // assetFree = 10, currencyFree = 1000
    const marketData: MarketData = { precision: { amount: 0.01 } };

    it('derives quantity from portfolio for symmetric levels', () => {
      // deriveLevelQuantity(centerPrice, assetFree, currencyFree, buyLevels, sellLevels, priceDecimals, spacingType, spacingValue, marketData, priceStep?)
      const { quantity: qty } = deriveLevelQuantity(100, 10, 1000, 2, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBeGreaterThan(0);
    });

    it('derives quantity from portfolio for asymmetric levels', () => {
      const { quantity: qty } = deriveLevelQuantity(100, 10, 1000, 3, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBeGreaterThan(0);
    });

    it('returns 0 for zero levels', () => {
      expect(deriveLevelQuantity(100, 10, 1000, 0, 0, 2, 'fixed', 5, marketData).quantity).toBe(0);
    });

    it('handles only buy levels', () => {
      const { quantity: qty } = deriveLevelQuantity(100, 10, 1000, 2, 0, 2, 'fixed', 5, marketData);

      expect(qty).toBeGreaterThan(0);
    });

    it('handles only sell levels', () => {
      const { quantity: qty } = deriveLevelQuantity(100, 10, 1000, 0, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBe(5);
    });

    it('applies amount limits', () => {
      const marketDataWithLimits: MarketData = { amount: { min: 0.1, max: 1 }, precision: { amount: 0.01 } };
      const { quantity: qty } = deriveLevelQuantity(100, 10, 1000, 2, 2, 2, 'fixed', 5, marketDataWithLimits);

      expect(qty).toBeLessThanOrEqual(1);
    });

    it('applies cost limits when bounds exist', () => {
      const marketDataWithCostLimits: MarketData = {
        cost: { min: 10, max: 1000 },
        precision: { amount: 0.01 },
      };
      const { quantity: qty } = deriveLevelQuantity(100, 10, 1000, 2, 2, 2, 'fixed', 5, marketDataWithCostLimits);

      expect(qty).toBeGreaterThan(0);
    });

    it('returns 0 for insufficient portfolio', () => {
      // assetFree = 0, currencyFree = 0
      const { quantity: qty } = deriveLevelQuantity(100, 0, 0, 2, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBe(0);
    });

    it('handles price step parameter', () => {
      const { quantity: qty } = deriveLevelQuantity(100, 10, 1000, 2, 2, 2, 'fixed', 5, marketData, 0.5);

      expect(qty).toBeGreaterThan(0);
    });

    it('handles negative level prices in calculation', () => {
      // Low center price where some buy levels would be negative - should skip those
      const { quantity: qty } = deriveLevelQuantity(10, 10, 1000, 5, 2, 2, 'fixed', 5, marketData);

      expect(qty).toBeGreaterThanOrEqual(0);
    });

    interface Grid {
      center: number;
      assetFree: number;
      currencyFree: number;
      buyLevels: number;
      sellLevels: number;
      spacingType: GridSpacingType;
      spacingValue: number;
      marketData: MarketData;
      /** The prices of its BUYs, in the order the grid places them: the lowest first */
      buyPrices?: number[];
    }

    /** The size of the grid, with the precision the strategy infers from the market data */
    const sizeOf = ({ center, assetFree, currencyFree, buyLevels, sellLevels, spacingType, spacingValue, marketData }: Grid) => {
      const { priceDecimals, priceStep } = inferPricePrecision(center, marketData);
      return deriveLevelQuantity(
        center,
        assetFree,
        currencyFree,
        buyLevels,
        sellLevels,
        priceDecimals,
        spacingType,
        spacingValue,
        marketData,
        priceStep,
      );
    };

    // The simulator charges the maker fee in currency on top of each BUY. Sized on the prices alone, the BUYs of a grid limited by its
    // currency needed the whole free currency before their fees: the last one placed, the highest, was refused at every attempt
    describe('limited by the free currency, on a market with a maker fee', () => {
      const buyOnly: Grid = {
        center: 100,
        assetFree: 0,
        currencyFree: 1000,
        buyLevels: 2,
        sellLevels: 0,
        spacingType: 'fixed',
        spacingValue: 5,
        marketData: documentedMarketData,
        buyPrices: [90, 95],
      };
      // Inside the 1 % window, so not rebalanced: 1.01 BTC a SELL, more than the currency pays a BUY
      const slightlyRichInAsset: Grid = {
        center: 100,
        assetFree: 5.05,
        currencyFree: 495,
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'percent',
        spacingValue: 0.1,
        marketData: documentedMarketData,
        buyPrices: [99.5, 99.6, 99.7, 99.8, 99.9],
      };
      const documentedOneLevelASide: Grid = {
        center: 61234.56,
        assetFree: 0.05,
        currencyFree: 3000,
        buyLevels: 1,
        sellLevels: 1,
        spacingType: 'percent',
        spacingValue: 1,
        marketData: documentedMarketData,
        buyPrices: [60622.2144],
      };
      const tenthPercentFee: Grid = {
        center: 100,
        assetFree: 10,
        currencyFree: 300,
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'percent',
        spacingValue: 1,
        marketData: tenthPercentFeeMarketData,
        buyPrices: [95, 96, 97, 98, 99],
      };
      const withoutFee: Grid = { ...buyOnly, marketData: omit(documentedMarketData, 'fee') };

      /** What the free currency has left once every BUY of the grid is placed, as the simulator reserves them: with the fee on top */
      const leftOnceEveryBuyIsPlaced = (grid: Grid) => {
        const { quantity } = sizeOf(grid);
        const fee = grid.marketData.fee?.maker ?? 0;
        return grid.buyPrices!.reduce((free, price) => free - quantity * price * (1 + fee), grid.currencyFree);
      };

      it.each`
        grid                       | description                                                            | expected
        ${buyOnly}                 | ${'a buy-only grid, all in currency'}                                  | ${5.4032441}
        ${slightlyRichInAsset}     | ${'a 5/5 grid slightly rich in asset'}                                 | ${0.9925819}
        ${documentedOneLevelASide} | ${'the documented grid of one level a side'}                           | ${0.04946702}
        ${tenthPercentFee}         | ${'a 5/5 grid at a 0.1 % maker fee'}                                   | ${0.61793}
        ${withoutFee}              | ${'a buy-only grid, on a market that states no fee, as charging none'} | ${5.4054054}
      `('sizes $description to $expected', ({ grid, expected }) => {
        expect(sizeOf(grid).quantity).toBe(expected);
      });

      it.each`
        grid                       | description
        ${buyOnly}                 | ${'a buy-only grid, all in currency'}
        ${slightlyRichInAsset}     | ${'a 5/5 grid slightly rich in asset'}
        ${documentedOneLevelASide} | ${'the documented grid of one level a side'}
        ${tenthPercentFee}         | ${'a 5/5 grid at a 0.1 % maker fee'}
      `('leaves the free currency paying every BUY of $description, the last one placed included', ({ grid }) => {
        expect(leftOnceEveryBuyIsPlaced(grid)).toBeGreaterThanOrEqual(0);
      });
    });

    // The quantity used to be raised to amount.min, or to cost.min at the lowest price, beyond what the free balances funded, and
    // left unrounded. On 0.0004 BTC and 25 USDT, a 5/5 grid of 0.0000859507… a level: the simulator refused the highest BUY and the
    // highest SELL for want of funds, and CCXTExchange truncated the amount to 0.00008, under cost.min, refusing 7 levels of 10
    describe('on free balances too small for every level at the market minimum', () => {
      const smallAccount: Grid = {
        center: 61234.56,
        assetFree: 0.0004,
        currencyFree: 25,
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'percent',
        spacingValue: 1,
        marketData: binanceStepsMarketData,
      };
      const smallInAsset: Grid = { ...smallAccount, currencyFree: 10_000 };
      // To 8 decimals, 0.00008596 at 58172.832, the configured lowest price, but 0.00008506 at 58785.1776, the lowest of the levels the
      // currency funds: 4 SELLs of 0.00008507 are funded at the latter
      const smallAtEightDecimals: Grid = { ...smallAccount, assetFree: 0.0003403, marketData: documentedMarketData };
      const tenthAmountMin: MarketData = { amount: { min: 0.1 }, precision: { price: 0.01, amount: 0.01 } };
      const underAmountMin: Grid = {
        center: 100,
        assetFree: 0.05,
        currencyFree: 5,
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'fixed',
        spacingValue: 1,
        marketData: { amount: { min: 0.1 }, precision: { price: 0.01, amount: 0.001 } },
      };
      const allInCurrency: Grid = {
        center: 100,
        assetFree: 0,
        currencyFree: 1000,
        buyLevels: 2,
        sellLevels: 2,
        spacingType: 'fixed',
        spacingValue: 5,
        marketData: tenthAmountMin,
      };
      const allInAsset: Grid = { ...allInCurrency, assetFree: 10, currencyFree: 0 };
      const documentedOneLevelASide: Grid = {
        center: 61234.56,
        assetFree: 0.05,
        currencyFree: 3000,
        buyLevels: 1,
        sellLevels: 1,
        spacingType: 'percent',
        spacingValue: 1,
        marketData: documentedMarketData,
      };
      // cost.max 210 at the highest price, 105: 2 a level
      const underMaximumCost: Grid = {
        center: 100,
        assetFree: 100,
        currencyFree: 100_000,
        buyLevels: 1,
        sellLevels: 1,
        spacingType: 'fixed',
        spacingValue: 5,
        marketData: { cost: { max: 210 }, precision: { price: 0.01, amount: 0.01 } },
      };

      const priceAtOf = ({ center, spacingType, spacingValue, marketData }: Grid) => {
        const { priceDecimals, priceStep } = inferPricePrecision(center, marketData);
        return (steps: number) => computeLevelPrice(center, steps, priceDecimals, spacingType, spacingValue, priceStep);
      };
      /** The lowest price an order of the grid is ever placed at: its lowest BUY, or the center price, where its lowest SELL buys back */
      const lowestPriceOf = (grid: Grid) => priceAtOf(grid)(-sizeOf(grid).buyLevels);
      /** What the free balances have left, the smaller of the two, once every order of the grid is placed, BUYs with the fee on top */
      const leftOnceEveryOrderIsPlaced = (grid: Grid) => {
        const { quantity, buyLevels, sellLevels } = sizeOf(grid);
        const priceAt = priceAtOf(grid);
        const fee = grid.marketData.fee?.maker ?? 0;
        const buys = Array.from({ length: buyLevels }, (_, i) => priceAt(-buyLevels + i));
        const currencyLeft = buys.reduce((free, price) => free - quantity * price * (1 + fee), grid.currencyFree);
        return Math.min(currencyLeft, grid.assetFree - sellLevels * quantity);
      };

      it.each`
        grid                       | description                                                           | expected
        ${smallAccount}            | ${'0.0004 BTC and 25 USDT: the farthest level of each side left out'} | ${{ quantity: 0.0001, buyLevels: 4, sellLevels: 4, minimumAmount: 0.00009 }}
        ${smallInAsset}            | ${'0.0004 BTC and 10000 USDT: the farthest sell level left out'}      | ${{ quantity: 0.0001, buyLevels: 5, sellLevels: 4, minimumAmount: 0.00009 }}
        ${smallAtEightDecimals}    | ${'to 8 decimals, at the minimum of the lowest level kept'}           | ${{ quantity: 0.00008507, buyLevels: 4, sellLevels: 4, minimumAmount: 0.00008506 }}
        ${underAmountMin}          | ${'0.05 BTC and 5 USDT, under amount.min 0.1 on either side: none'}   | ${{ quantity: 0, buyLevels: 0, sellLevels: 0, minimumAmount: 0.1 }}
        ${allInCurrency}           | ${'all in currency: the sell levels left out'}                        | ${{ quantity: 5.4, buyLevels: 2, sellLevels: 0, minimumAmount: 0.1 }}
        ${allInAsset}              | ${'all in asset: the buy levels left out'}                            | ${{ quantity: 5, buyLevels: 0, sellLevels: 2, minimumAmount: 0.1 }}
        ${documentedOneLevelASide} | ${'the documented grid of one level a side: whole'}                   | ${{ quantity: 0.04946702, buyLevels: 1, sellLevels: 1, minimumAmount: 0.00008248 }}
        ${underMaximumCost}        | ${'a grid capped by cost.max at its highest price'}                   | ${{ quantity: 2, buyLevels: 1, sellLevels: 1, minimumAmount: 0.01 }}
      `('sizes $description', ({ grid, expected }) => {
        expect(sizeOf(grid)).toEqual(expected);
      });

      it.each`
        grid                       | description
        ${smallAccount}            | ${'0.0004 BTC and 25 USDT'}
        ${smallInAsset}            | ${'0.0004 BTC and 10000 USDT'}
        ${smallAtEightDecimals}    | ${'0.0003403 BTC and 25 USDT, to 8 decimals'}
        ${documentedOneLevelASide} | ${'the documented grid of one level a side'}
      `('sizes every order of $description at a cost of cost.min or more, its lowest price included', ({ grid }) => {
        expect(sizeOf(grid).quantity * lowestPriceOf(grid)).toBeGreaterThanOrEqual(grid.marketData.cost.min);
      });

      it.each`
        grid                       | description
        ${smallAccount}            | ${'0.0004 BTC and 25 USDT'}
        ${smallInAsset}            | ${'0.0004 BTC and 10000 USDT'}
        ${smallAtEightDecimals}    | ${'0.0003403 BTC and 25 USDT, to 8 decimals'}
        ${allInCurrency}           | ${'all in currency'}
        ${allInAsset}              | ${'all in asset'}
        ${documentedOneLevelASide} | ${'the documented grid of one level a side'}
      `('leaves the free balances paying every order of $description', ({ grid }) => {
        expect(leftOnceEveryOrderIsPlaced(grid)).toBeGreaterThanOrEqual(0);
      });

      // CCXTExchange truncates an amount to the step: one off the step was sent smaller than sized
      it.each`
        grid                | description
        ${smallAccount}     | ${'0.0004 BTC and 25 USDT'}
        ${smallInAsset}     | ${'0.0004 BTC and 10000 USDT'}
        ${underMaximumCost} | ${'a grid capped by cost.max'}
      `('sizes $description on the amount step', ({ grid }) => {
        expect(countDecimals(sizeOf(grid).quantity)).toBeLessThanOrEqual(inferAmountPrecision(grid.marketData));
      });
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
