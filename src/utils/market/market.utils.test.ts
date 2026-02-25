import { MarketData } from '@services/exchange/exchange.types';
import { describe, expect, it } from 'vitest';
import * as utils from './market.utils';

describe('Market Utils', () => {
  const marketData: MarketData = {
    price: { min: 10, max: 100 },
    amount: { min: 1, max: 10 },
    cost: { min: 10, max: 1000 },
  };

  describe('checkOrderPrice', () => {
    it.each`
      price  | data                                             | description
      ${50}  | ${marketData}                                    | ${'valid price'}
      ${10}  | ${marketData}                                    | ${'min price'}
      ${100} | ${marketData}                                    | ${'max price'}
      ${50}  | ${{}}                                            | ${'no limits'}
      ${5}   | ${{ price: { min: undefined, max: undefined } }} | ${'undefined limits'}
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
  });

  describe('checkOrderAmount', () => {
    it.each`
      amount | data                                              | description
      ${5}   | ${marketData}                                     | ${'valid amount'}
      ${1}   | ${marketData}                                     | ${'min amount'}
      ${10}  | ${marketData}                                     | ${'max amount'}
      ${5}   | ${{ amount: { min: 1 } }}                         | ${'above min'}
      ${5}   | ${{ amount: { min: undefined, max: undefined } }} | ${'undefined limits'}
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
  });

  describe('checkOrderCost', () => {
    it.each`
      amount | price  | data                            | description
      ${2}   | ${10}  | ${marketData}                   | ${'valid cost'}
      ${1}   | ${10}  | ${marketData}                   | ${'min cost'}
      ${10}  | ${100} | ${marketData}                   | ${'max cost'}
      ${20}  | ${1}   | ${{ cost: { min: 10 } }}        | ${'above min cost'}
      ${5}   | ${5}   | ${{ cost: { min: undefined } }} | ${'undefined limits'}
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
  });
});
