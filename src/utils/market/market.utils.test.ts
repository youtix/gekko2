import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { MarketData } from '@services/exchange/exchange.types';
import { describe, expect, it } from 'vitest';
import * as utils from './market.utils';

describe('Market Utils', () => {
  const marketData: MarketData = {
    price: { min: 10, max: 100 },
    amount: { min: 1, max: 10 },
    cost: { min: 10, max: 1000 },
  };
  // A Binance market as ccxt parses it when its PRICE_FILTER disables maxPrice with 0, the value ccxt copies into price.max
  const binanceMarketData: MarketData = {
    price: { min: 0.01, max: 0 },
    amount: { min: 0.00001, max: 9000 },
    cost: { min: 5, max: 9000000 },
  };

  describe('checkOrderPrice', () => {
    it.each`
      price   | data                                             | description
      ${50}   | ${marketData}                                    | ${'valid price'}
      ${10}   | ${marketData}                                    | ${'min price'}
      ${100}  | ${marketData}                                    | ${'max price'}
      ${50}   | ${{}}                                            | ${'no limits'}
      ${5}    | ${{ price: { min: undefined, max: undefined } }} | ${'undefined limits'}
      ${1e9}  | ${{ price: { min: 0.01, max: 0 } }}              | ${'a max of 0, which sets no maximum (Binance PRICE_FILTER)'}
      ${1e9}  | ${{ price: { min: 0.01, max: -1 } }}             | ${'a negative max, which sets no maximum'}
      ${1e9}  | ${{ price: { min: 0.01, max: NaN } }}            | ${'a NaN max, which sets no maximum'}
      ${1e-9} | ${{ price: { min: 0, max: 100 } }}               | ${'a min of 0, which sets no minimum'}
      ${1e-9} | ${{ price: { min: -1, max: 100 } }}              | ${'a negative min, which sets no minimum'}
      ${1e-9} | ${{ price: { min: NaN, max: 100 } }}             | ${'a NaN min, which sets no minimum'}
    `('should return valid for $description', ({ price, data }) => {
      expect(utils.checkOrderPrice(price, data)).toEqual({ isValid: true, value: price });
    });

    it.each`
      price  | data                      | description
      ${9}   | ${marketData}             | ${'below min'}
      ${101} | ${marketData}             | ${'above max'}
      ${9}   | ${{ price: { min: 10 } }} | ${'below specific min'}
      ${11}  | ${{ price: { max: 10 } }} | ${'above specific max'}
    `('should return invalid for $description', ({ price, data }) => {
      expect(utils.checkOrderPrice(price, data)).toMatchObject({ isValid: false, reason: 'price' });
    });

    it.each`
      price       | data                                     | min          | max          | description
      ${NaN}      | ${marketData}                            | ${10}        | ${100}       | ${'NaN with limits'}
      ${NaN}      | ${{}}                                    | ${undefined} | ${undefined} | ${'NaN without limits'}
      ${Infinity} | ${marketData}                            | ${10}        | ${100}       | ${'Infinity with limits'}
      ${Infinity} | ${{}}                                    | ${undefined} | ${undefined} | ${'Infinity without limits'}
      ${-1}       | ${marketData}                            | ${10}        | ${100}       | ${'a negative price with limits'}
      ${-1}       | ${{}}                                    | ${undefined} | ${undefined} | ${'a negative price without limits'}
      ${0}        | ${marketData}                            | ${10}        | ${100}       | ${'a zero price with limits'}
      ${0}        | ${{}}                                    | ${undefined} | ${undefined} | ${'a zero price without limits'}
      ${0}        | ${{ price: { min: 0 } }}                 | ${undefined} | ${undefined} | ${'a zero price with a min of 0, reported as no minimum'}
      ${5}        | ${{ price: { min: 10, max: 0 } }}        | ${10}        | ${undefined} | ${'a price below the minimum with a max of 0, reported as no maximum'}
      ${5}        | ${{ price: { min: 10, max: NaN } }}      | ${10}        | ${undefined} | ${'a price below the minimum with a NaN max, reported as no maximum'}
      ${5}        | ${{ price: { min: 10, max: Infinity } }} | ${10}        | ${undefined} | ${'a price below the minimum with an infinite max, reported as no maximum'}
    `('should return invalid with the market limits for $description', ({ price, data, min, max }) => {
      expect(utils.checkOrderPrice(price, data)).toEqual({ isValid: false, reason: 'price', min, max });
    });
  });

  describe('checkOrderAmount', () => {
    it.each`
      amount  | data                                              | description
      ${5}    | ${marketData}                                     | ${'valid amount'}
      ${1}    | ${marketData}                                     | ${'min amount'}
      ${10}   | ${marketData}                                     | ${'max amount'}
      ${5}    | ${{ amount: { min: 1 } }}                         | ${'above min'}
      ${5}    | ${{ amount: { min: undefined, max: undefined } }} | ${'undefined limits'}
      ${1e9}  | ${{ amount: { min: 0.01, max: 0 } }}              | ${'a max of 0, which sets no maximum'}
      ${1e9}  | ${{ amount: { min: 0.01, max: -1 } }}             | ${'a negative max, which sets no maximum'}
      ${1e9}  | ${{ amount: { min: 0.01, max: NaN } }}            | ${'a NaN max, which sets no maximum'}
      ${1e-9} | ${{ amount: { min: 0, max: 100 } }}               | ${'a min of 0, which sets no minimum'}
      ${1e-9} | ${{ amount: { min: -1, max: 100 } }}              | ${'a negative min, which sets no minimum'}
      ${1e-9} | ${{ amount: { min: NaN, max: 100 } }}             | ${'a NaN min, which sets no minimum'}
    `('should return valid for $description', ({ amount, data }) => {
      expect(utils.checkOrderAmount(amount, data)).toEqual({ isValid: true, value: amount });
    });

    it.each`
      amount | data                               | description
      ${0.5} | ${marketData}                      | ${'below min'}
      ${11}  | ${marketData}                      | ${'above max'}
      ${0.5} | ${{ amount: { min: 1 } }}          | ${'below specific min'}
      ${11}  | ${{ amount: { min: 1, max: 10 } }} | ${'above specific max'}
    `('should return invalid for $description', ({ amount, data }) => {
      expect(utils.checkOrderAmount(amount, data)).toMatchObject({ isValid: false, reason: 'amount' });
    });

    it.each`
      amount      | data                                     | min          | max          | description
      ${NaN}      | ${marketData}                            | ${1}         | ${10}        | ${'NaN with limits'}
      ${NaN}      | ${{}}                                    | ${undefined} | ${undefined} | ${'NaN without limits'}
      ${Infinity} | ${marketData}                            | ${1}         | ${10}        | ${'Infinity with limits'}
      ${Infinity} | ${{}}                                    | ${undefined} | ${undefined} | ${'Infinity without limits'}
      ${-1}       | ${marketData}                            | ${1}         | ${10}        | ${'a negative amount with limits'}
      ${-1}       | ${{}}                                    | ${undefined} | ${undefined} | ${'a negative amount without limits'}
      ${0}        | ${marketData}                            | ${1}         | ${10}        | ${'a zero amount with limits'}
      ${0}        | ${{}}                                    | ${undefined} | ${undefined} | ${'a zero amount without limits'}
      ${0}        | ${{ amount: { min: 0 } }}                | ${undefined} | ${undefined} | ${'a zero amount with a min of 0, reported as no minimum'}
      ${0.5}      | ${{ amount: { min: 1, max: 0 } }}        | ${1}         | ${undefined} | ${'an amount below the minimum with a max of 0, reported as no maximum'}
      ${0.5}      | ${{ amount: { min: 1, max: NaN } }}      | ${1}         | ${undefined} | ${'an amount below the minimum with a NaN max, reported as no maximum'}
      ${0.5}      | ${{ amount: { min: 1, max: Infinity } }} | ${1}         | ${undefined} | ${'an amount below the minimum with an infinite max, reported as no maximum'}
    `('should return invalid with the market limits for $description', ({ amount, data, min, max }) => {
      expect(utils.checkOrderAmount(amount, data)).toEqual({ isValid: false, reason: 'amount', min, max });
    });
  });

  describe('checkOrderCost', () => {
    it.each`
      amount  | price  | data                                 | description
      ${2}    | ${10}  | ${marketData}                        | ${'valid cost'}
      ${1}    | ${10}  | ${marketData}                        | ${'min cost'}
      ${10}   | ${100} | ${marketData}                        | ${'max cost'}
      ${20}   | ${1}   | ${{ cost: { min: 10 } }}             | ${'above min cost'}
      ${5}    | ${5}   | ${{ cost: { min: undefined } }}      | ${'undefined limits'}
      ${1}    | ${1e9} | ${{ cost: { min: 5, max: 0 } }}      | ${'a max of 0, which sets no maximum'}
      ${1}    | ${1e9} | ${{ cost: { min: 5, max: -1 } }}     | ${'a negative max, which sets no maximum'}
      ${1}    | ${1e9} | ${{ cost: { min: 5, max: NaN } }}    | ${'a NaN max, which sets no maximum'}
      ${1e-9} | ${1}   | ${{ cost: { min: 0, max: 1000 } }}   | ${'a min of 0, which sets no minimum'}
      ${1e-9} | ${1}   | ${{ cost: { min: -1, max: 1000 } }}  | ${'a negative min, which sets no minimum'}
      ${1e-9} | ${1}   | ${{ cost: { min: NaN, max: 1000 } }} | ${'a NaN min, which sets no minimum'}
    `('should succeed for $description', ({ amount, price, data }) => {
      expect(utils.checkOrderCost(amount, price, data)).toEqual({ isValid: true, value: amount * price });
    });

    it.each`
      amount | price  | data                                | description
      ${1}   | ${5}   | ${marketData}                       | ${'below min'}
      ${11}  | ${100} | ${marketData}                       | ${'above max'}
      ${5}   | ${1}   | ${{ cost: { min: 10 } }}            | ${'below specific min'}
      ${50}  | ${21}  | ${{ cost: { min: 10, max: 1000 } }} | ${'above specific max'}
    `('should return invalid for $description', ({ amount, price, data }) => {
      expect(utils.checkOrderCost(amount, price, data)).toMatchObject({ isValid: false, reason: 'cost' });
    });

    it.each`
      amount      | price    | data                                    | min          | max          | description
      ${NaN}      | ${10}    | ${marketData}                           | ${10}        | ${1000}      | ${'a NaN amount with limits'}
      ${NaN}      | ${10}    | ${{}}                                   | ${undefined} | ${undefined} | ${'a NaN amount without limits'}
      ${1}        | ${NaN}   | ${{}}                                   | ${undefined} | ${undefined} | ${'a NaN price without limits'}
      ${Infinity} | ${10}    | ${marketData}                           | ${10}        | ${1000}      | ${'an infinite cost with limits'}
      ${Infinity} | ${10}    | ${{}}                                   | ${undefined} | ${undefined} | ${'an infinite cost without limits'}
      ${1e200}    | ${1e200} | ${{}}                                   | ${undefined} | ${undefined} | ${'a cost overflowing to Infinity'}
      ${-1}       | ${10}    | ${marketData}                           | ${10}        | ${1000}      | ${'a negative cost with limits'}
      ${-1}       | ${10}    | ${{}}                                   | ${undefined} | ${undefined} | ${'a negative cost without limits'}
      ${0}        | ${10}    | ${marketData}                           | ${10}        | ${1000}      | ${'a zero cost with limits'}
      ${0}        | ${10}    | ${{}}                                   | ${undefined} | ${undefined} | ${'a zero cost without limits'}
      ${0}        | ${10}    | ${{ cost: { min: 0 } }}                 | ${undefined} | ${undefined} | ${'a zero cost with a min of 0, reported as no minimum'}
      ${1}        | ${5}     | ${{ cost: { min: 10, max: 0 } }}        | ${10}        | ${undefined} | ${'a cost below the minimum with a max of 0, reported as no maximum'}
      ${1}        | ${5}     | ${{ cost: { min: 10, max: NaN } }}      | ${10}        | ${undefined} | ${'a cost below the minimum with a NaN max, reported as no maximum'}
      ${1}        | ${5}     | ${{ cost: { min: 10, max: Infinity } }} | ${10}        | ${undefined} | ${'a cost below the minimum with an infinite max, reported as no maximum'}
    `('should return invalid with the market limits for $description', ({ amount, price, data, min, max }) => {
      expect(utils.checkOrderCost(amount, price, data)).toEqual({ isValid: false, reason: 'cost', min, max });
    });
  });

  describe('getMarketOrderLimits', () => {
    // BTCUSDT as ccxt parses it from Binance: LOT_SIZE (amount) up to 9000 BTC, MARKET_LOT_SIZE (market) from 0, no minimum, to 86.27382215
    const binanceMarketOrderData: MarketData = { ...binanceMarketData, market: { min: 0, max: 86.27382215 } };

    it.each`
      amount                         | market                                | narrowed                              | description
      ${{ min: 1, max: 10 }}         | ${undefined}                          | ${{ min: 1, max: 10 }}                | ${'no market range'}
      ${{ min: 1, max: 10 }}         | ${{ min: 0.5, max: 5 }}               | ${{ min: 1, max: 5 }}                 | ${'a lower market maximum'}
      ${{ min: 1, max: 10 }}         | ${{ min: 2, max: 50 }}                | ${{ min: 2, max: 10 }}                | ${'a higher market minimum'}
      ${{ min: 1, max: 10 }}         | ${{ min: 2, max: 5 }}                 | ${{ min: 2, max: 5 }}                 | ${'a market range within the amount range'}
      ${{ min: 0.00001, max: 9000 }} | ${{ min: 0, max: 86.27382215 }}       | ${{ min: 0.00001, max: 86.27382215 }} | ${'a market minimum of 0, which sets no minimum (Binance MARKET_LOT_SIZE)'}
      ${{ min: 1, max: 0 }}          | ${{ min: -1, max: 5 }}                | ${{ min: 1, max: 5 }}                 | ${'an amount maximum of 0 and a negative market minimum, which set nothing'}
      ${{ min: 0, max: 0 }}          | ${{ min: 0, max: 0 }}                 | ${{ min: undefined, max: undefined }} | ${'bounds of 0 only, which set nothing'}
      ${{ min: 1, max: 10 }}         | ${{ min: NaN, max: Infinity }}        | ${{ min: 1, max: 10 }}                | ${'a NaN market minimum and an infinite market maximum, which set nothing'}
      ${undefined}                   | ${{ min: 2, max: 5 }}                 | ${{ min: 2, max: 5 }}                 | ${'no amount range'}
      ${{ min: 1, max: 10 }}         | ${{ min: undefined, max: undefined }} | ${{ min: 1, max: 10 }}                | ${'a market range without bounds, as getMarketData gives it for Hyperliquid'}
    `('narrows the amount range to the tighter bounds for $description', ({ amount, market, narrowed }) => {
      expect(utils.getMarketOrderLimits({ amount, market }).amount).toEqual(narrowed);
    });

    it('leaves the price and the cost limits as they are', () => {
      expect(utils.getMarketOrderLimits(binanceMarketOrderData)).toMatchObject({
        price: binanceMarketData.price,
        cost: binanceMarketData.cost,
      });
    });

    // The limits Binance applies to a market order: 100 BTC passes LOT_SIZE, but not MARKET_LOT_SIZE
    it('makes assertOrderWithinLimits refuse an amount above the market maximum, naming the narrowed range', () => {
      const marketData = utils.getMarketOrderLimits(binanceMarketOrderData);
      expect(() => utils.assertOrderWithinLimits({ tag: 'exchange', amount: 100, price: 60000, marketData })).toThrow(
        new OrderOutOfRangeError('exchange', 'amount', 100, 0.00001, 86.27382215),
      );
    });
  });

  describe('assertOrderWithinLimits', () => {
    it.each`
      amount   | price    | data                 | description
      ${2}     | ${50}    | ${marketData}        | ${'an order within the market limits'}
      ${2}     | ${50}    | ${{}}                | ${'an order on a market without limits'}
      ${0.001} | ${60000} | ${binanceMarketData} | ${'an order on a Binance market, whose max price of 0 sets no maximum'}
    `('should return the validated amount, price and cost for $description', ({ amount, price, data }) => {
      expect(utils.assertOrderWithinLimits({ tag: 'exchange', amount, price, marketData: data })).toEqual({
        amount,
        price,
        cost: amount * price,
      });
    });

    it.each`
      amount   | price    | data                       | property    | value       | detail                                                     | description
      ${2}     | ${NaN}   | ${marketData}              | ${'price'}  | ${NaN}      | ${'is invalid. Expected a finite number greater than 0.'}  | ${'a NaN price'}
      ${NaN}   | ${NaN}   | ${marketData}              | ${'price'}  | ${NaN}      | ${'is invalid. Expected a finite number greater than 0.'}  | ${'a NaN price and a NaN amount (price checked first)'}
      ${2}     | ${5}     | ${marketData}              | ${'price'}  | ${5}        | ${'is out of range. Expected a value between 10 and 100.'} | ${'a price below the market minimum'}
      ${NaN}   | ${50}    | ${marketData}              | ${'amount'} | ${NaN}      | ${'is invalid. Expected a finite number greater than 0.'}  | ${'a NaN amount with limits'}
      ${0}     | ${50}    | ${{}}                      | ${'amount'} | ${0}        | ${'is invalid. Expected a finite number greater than 0.'}  | ${'a zero amount without limits'}
      ${-1}    | ${50}    | ${{ amount: { max: 10 } }} | ${'amount'} | ${-1}       | ${'is invalid. Expected a finite number greater than 0.'}  | ${'a negative amount with only a maximum'}
      ${11}    | ${50}    | ${marketData}              | ${'amount'} | ${11}       | ${'is out of range. Expected a value between 1 and 10.'}   | ${'an amount above the market maximum'}
      ${2}     | ${2}     | ${{ cost: { min: 10 } }}   | ${'cost'}   | ${4}        | ${'is too low. Minimum allowed is 10.'}                    | ${'a cost below the market minimum'}
      ${20}    | ${100}   | ${{ cost: { max: 1000 } }} | ${'cost'}   | ${2000}     | ${'is too high. Maximum allowed is 1000.'}                 | ${'a cost above the market maximum'}
      ${1e200} | ${1e200} | ${{}}                      | ${'cost'}   | ${Infinity} | ${'is invalid. Expected a finite number greater than 0.'}  | ${'a cost overflowing to Infinity'}
      ${0.001} | ${0.001} | ${binanceMarketData}       | ${'price'}  | ${0.001}    | ${'is too low. Minimum allowed is 0.01.'}                  | ${'a price below the minimum of a Binance market, whose max price of 0 is no maximum'}
    `('should throw for $description', ({ amount, price, data, property, value, detail }) => {
      expect(() => utils.assertOrderWithinLimits({ tag: 'exchange', amount, price, marketData: data })).toThrow(
        `[EXCHANGE] Order '${property}' with value ${value} ${detail}`,
      );
    });

    it('should throw an OrderOutOfRangeError', () => {
      expect(() => utils.assertOrderWithinLimits({ tag: 'exchange', amount: NaN, price: 50, marketData })).toThrow(OrderOutOfRangeError);
    });

    it('should prefix the error message with the given tag', () => {
      expect(() => utils.assertOrderWithinLimits({ tag: 'trader', amount: NaN, price: 50, marketData })).toThrow('[TRADER] ');
    });
  });
});
