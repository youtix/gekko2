import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import * as logger from '@services/logger';
import * as processUtils from '@utils/process/process.utils';
import { NetworkError } from 'ccxt';
import { describe, expect, it, vi } from 'vitest';
import { MarketData } from './exchange.types';
import * as utils from './exchange.utils';

// Mocks
vi.mock('@services/logger', () => ({
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@utils/process/process.utils', () => ({
  wait: vi.fn().mockResolvedValue(undefined),
}));

describe('Exchange Utils', () => {
  describe('checkOrderPrice', () => {
    const marketData: MarketData = {
      price: { min: 10, max: 100 },
      amount: { min: 1, max: 10 },
      cost: { min: 10, max: 1000 },
    };
    it.each`
      price  | marketData
      ${50}  | ${marketData}
      ${10}  | ${marketData}
      ${100} | ${marketData}
      ${50}  | ${{}}
      ${5}   | ${{ price: { min: undefined, max: undefined } }}
    `('should return $price with market data $marketData', ({ price, marketData }) => {
      expect(utils.checkOrderPrice(price, marketData)).toBe(price);
    });

    it.each`
      price  | marketData
      ${9}   | ${marketData}
      ${101} | ${marketData}
      ${9}   | ${{ price: { min: 10 } }}
      ${11}  | ${{ price: { max: 10 } }}
    `('should throw when price is $price with market data $marketData', ({ price, marketData }) => {
      expect(() => utils.checkOrderPrice(price, marketData)).toThrow(OrderOutOfRangeError);
    });

    it('should throw specific error message for low price', () => {
      expect(() => utils.checkOrderPrice(5, marketData)).toThrow(/price/);
    });
  });

  describe('checkOrderAmount', () => {
    const marketData: MarketData = {
      price: { min: 10, max: 100 },
      amount: { min: 1, max: 10 },
      cost: { min: 10, max: 1000 },
    };

    it.each`
      amount | marketData                         | expectedError
      ${0.5} | ${marketData}                      | ${OrderOutOfRangeError}
      ${11}  | ${marketData}                      | ${OrderOutOfRangeError}
      ${0.5} | ${{ amount: { min: 1 } }}          | ${OrderOutOfRangeError}
      ${11}  | ${{ amount: { min: 1, max: 10 } }} | ${OrderOutOfRangeError}
    `(
      'should throw $expectedError when amount is $amount with market data $marketData',
      ({ amount, marketData, expectedError }) => {
        expect(() => utils.checkOrderAmount(amount, marketData)).toThrow(expectedError);
      },
    );

    it.each`
      amount | marketData
      ${5}   | ${marketData}
      ${1}   | ${marketData}
      ${10}  | ${marketData}
      ${5}   | ${{ amount: { min: 1 } }}
    `('should return $amount when amount is $amount with market data $marketData', ({ amount, marketData }) => {
      expect(utils.checkOrderAmount(amount, marketData)).toBe(amount);
    });
  });

  describe('checkOrderCost', () => {
    const marketData: MarketData = {
      price: { min: 10, max: 100 },
      amount: { min: 1, max: 10 },
      cost: { min: 10, max: 1000 },
    };

    it.each`
      amount | price  | marketData                          | expectedError
      ${1}   | ${5}   | ${marketData}                       | ${OrderOutOfRangeError}
      ${11}  | ${100} | ${marketData}                       | ${OrderOutOfRangeError}
      ${5}   | ${1}   | ${{ cost: { min: 10 } }}            | ${OrderOutOfRangeError}
      ${50}  | ${21}  | ${{ cost: { min: 10, max: 1000 } }} | ${OrderOutOfRangeError}
    `(
      'should throw $expectedError when cost (amount $amount * price $priceLimit) with market data $marketData',
      ({ amount, price, marketData, expectedError }) => {
        expect(() => utils.checkOrderCost(amount, price, marketData)).toThrow(expectedError);
      },
    );

    it.each`
      amount | price  | marketData
      ${2}   | ${10}  | ${marketData}
      ${1}   | ${10}  | ${marketData}
      ${10}  | ${100} | ${marketData}
      ${20}  | ${1}   | ${{ cost: { min: 10 } }}
    `(
      'should NOT throw when cost (amount $amount * price $priceLimit) with market data $marketData',
      ({ amount, price, marketData }) => {
        expect(() => utils.checkOrderCost(amount, price, marketData)).not.toThrow();
      },
    );
  });

  describe('retry', () => {
    it('should return result when function succeeds immediately', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await utils.retry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on NetworkError and eventually succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('fail 1'))
        .mockRejectedValueOnce(new NetworkError('fail 2'))
        .mockResolvedValue('success');

      const result = await utils.retry(fn, 1, 3);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(logger.warning).toHaveBeenCalledTimes(2);
      expect(processUtils.wait).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new NetworkError('fail'));
      await expect(utils.retry(fn, 1, 2)).rejects.toThrow(NetworkError);
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries = 3 calls? No, 1 (initial) -> fail -> catch -> retry(2) -> fail -> catch -> retry(3) -> fail -> catch -> throw.
      // Wait, is it recursive? Yes.
      // call 1 (currRetry=1): fails. if (1 <= 2) wait, retry(2).
      // call 2 (currRetry=2): fails. if (2 <= 2) wait, retry(3).
      // call 3 (currRetry=3): fails. if (3 <= 2) false. throw.
      // So 3 calls.
    });

    it('should throw immediately on non-NetworkError', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Fatal error'));
      await expect(utils.retry(fn)).rejects.toThrow('Fatal error');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('mapCcxtTradeToTrade', () => {
    it('should map valid CCXT trade correctly', () => {
      const ccxtTrade: any = {
        id: '123',
        order: '123',
        amount: 10,
        price: 100,
        timestamp: 1600000000000,
        fee: { rate: 0.001 },
      };
      const expected = {
        id: '123',
        amount: 10,
        price: 100,
        timestamp: 1600000000000,
        fee: { rate: 0.001 },
      };
      expect(utils.mapCcxtTradeToTrade(ccxtTrade)).toEqual(expected);
    });

    it('should handle missing fields with defaults', () => {
      const ccxtTrade: any = {};
      // Date.now is used in default, so we mock it or check close enough?
      // Better to check specific fields
      const result = utils.mapCcxtTradeToTrade(ccxtTrade);
      expect(result.id).toBe('');
      expect(result.amount).toBe(0);
      expect(result.price).toBe(0);
      expect(result.fee.rate).toBe(0);
      expect(typeof result.timestamp).toBe('number');
    });
  });

  describe('mapCcxtOrderToOrder', () => {
    it.each`
      status        | expectedStatus
      ${'open'}     | ${'open'}
      ${'canceled'} | ${'canceled'}
      ${'closed'}   | ${'closed'}
      ${'expired'}  | ${'canceled'}
      ${'rejected'} | ${'canceled'}
      ${undefined}  | ${'open'}
      ${null}       | ${'open'}
      ${''}         | ${'open'}
    `('should map status $status to $expectedStatus', ({ status, expectedStatus }) => {
      const ccxtOrder: any = {
        id: '1',
        status,
        filled: 5,
        remaining: 5,
        price: 100,
        timestamp: 1000,
      };
      const result = utils.mapCcxtOrderToOrder(ccxtOrder);
      expect(result.status).toBe(expectedStatus);
      expect(result.id).toBe('1');
    });
  });

  describe('mapOhlcvToCandles', () => {
    it('should map OHLCV list unique candles', () => {
      const ohlcvList: any[] = [
        [1000, 10, 15, 5, 12, 100],
        [2000, 12, 14, 11, 13, 200],
      ];
      const result = utils.mapOhlcvToCandles(ohlcvList);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        start: 1000,
        open: 10,
        high: 15,
        low: 5,
        close: 12,
        volume: 100,
      });
    });

    it('should handle empty/partial data', () => {
      const ohlcvList: any[] = [[]];
      const result = utils.mapOhlcvToCandles(ohlcvList);
      expect(result[0]).toEqual({
        start: 0,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 0,
      });
    });
  });
});
