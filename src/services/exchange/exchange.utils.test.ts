import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import * as logger from '@services/logger';
import { NetworkError } from 'ccxt';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { describe, expect, it, vi } from 'vitest';
import { MarketData } from './exchange.types';
import * as utils from './exchange.utils';

vi.mock('@services/logger', () => ({
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@utils/process/process.utils', () => ({
  wait: vi.fn().mockResolvedValue(undefined),
}));

describe('Exchange Utils', () => {
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
    `('should return $price for $description', ({ price, data }) => {
      expect(utils.checkOrderPrice(price, data)).toBe(price);
    });

    it.each`
      price  | data                      | description
      ${9}   | ${marketData}             | ${'below min'}
      ${101} | ${marketData}             | ${'above max'}
      ${9}   | ${{ price: { min: 10 } }} | ${'below specific min'}
      ${11}  | ${{ price: { max: 10 } }} | ${'above specific max'}
    `('should throw OrderOutOfRangeError for $description', ({ price, data }) => {
      expect(() => utils.checkOrderPrice(price, data)).toThrow(OrderOutOfRangeError);
    });

    it('should throw with specific message for price violation', () => {
      expect(() => utils.checkOrderPrice(5, marketData)).toThrow(/price/);
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
    `('should return $amount for $description', ({ amount, data }) => {
      expect(utils.checkOrderAmount(amount, data)).toBe(amount);
    });

    it.each`
      amount | data                               | description
      ${0.5} | ${marketData}                      | ${'below min'}
      ${11}  | ${marketData}                      | ${'above max'}
      ${0.5} | ${{ amount: { min: 1 } }}          | ${'below specific min'}
      ${11}  | ${{ amount: { min: 1, max: 10 } }} | ${'above specific max'}
    `('should throw OrderOutOfRangeError for $description', ({ amount, data }) => {
      expect(() => utils.checkOrderAmount(amount, data)).toThrow(OrderOutOfRangeError);
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
      expect(() => utils.checkOrderCost(amount, price, data)).not.toThrow();
    });

    it.each`
      amount | price  | data                                | description
      ${1}   | ${5}   | ${marketData}                       | ${'below min'}
      ${11}  | ${100} | ${marketData}                       | ${'above max'}
      ${5}   | ${1}   | ${{ cost: { min: 10 } }}            | ${'below specific min'}
      ${50}  | ${21}  | ${{ cost: { min: 10, max: 1000 } }} | ${'above specific max'}
    `('should throw OrderOutOfRangeError for $description', ({ amount, price, data }) => {
      expect(() => utils.checkOrderCost(amount, price, data)).toThrow(OrderOutOfRangeError);
    });
  });

  describe('retry', () => {
    it('should return result immediately on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      expect(await utils.retry(fn)).toBe('success');
    });

    it('should retry on NetworkError', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new NetworkError('fail 1')).mockResolvedValue('success');
      expect(await utils.retry(fn)).toBe('success');
    });

    it('should verify retry called correctly', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new NetworkError('fail 1')).mockResolvedValue('success');
      await utils.retry(fn);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new NetworkError('fail'));
      await expect(utils.retry(fn, 1, 2)).rejects.toThrow(NetworkError);
    });

    it('should throw non-NetworkError immediately', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Fatal'));
      await expect(utils.retry(fn)).rejects.toThrow('Fatal');
    });

    it('should log error on failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Fatal'));
      await expect(utils.retry(fn)).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith('exchange', expect.stringContaining('Fatal'));
    });
  });

  describe('mapCcxtTradeToTrade', () => {
    const timestamp = 1600000000000;
    it('should map valid trade', () => {
      const input: any = { id: '1', order: 'ord1', amount: 10, price: 100, timestamp, fee: { rate: 0.001 } };
      expect(utils.mapCcxtTradeToTrade(input)).toEqual({
        id: 'ord1',
        amount: 10,
        price: 100,
        timestamp,
        fee: { rate: 0.001 },
      });
    });

    it('should handle missing fields', () => {
      const input: any = {};
      const result = utils.mapCcxtTradeToTrade(input);
      expect(result).toMatchObject({ id: '', amount: 0, price: 0, fee: { rate: 0 } });
    });
  });

  describe('mapCcxtOrderToOrder', () => {
    it.each`
      status        | expected
      ${'open'}     | ${'open'}
      ${'model'}    | ${'closed'}
      ${undefined}  | ${'open'}
      ${'canceled'} | ${'canceled'}
      ${'rejected'} | ${'canceled'}
      ${'expired'}  | ${'canceled'}
      ${'closed'}   | ${'closed'}
      ${'other'}    | ${'closed'}
    `('should map status $status to $expected', ({ status, expected }) => {
      const order: any = { id: '1', status, filled: 5, remaining: 5, price: 100, timestamp: 1000 };
      expect(utils.mapCcxtOrderToOrder(order)).toMatchObject({ status: expected });
    });
  });

  describe('mapOhlcvToCandles', () => {
    it('should map candles correctly', () => {
      const input: any[] = [[1000, 10, 15, 5, 12, 100]];
      expect(utils.mapOhlcvToCandles(input)).toEqual([
        {
          start: 1000,
          open: 10,
          high: 15,
          low: 5,
          close: 12,
          volume: 100,
        },
      ]);
    });

    it('should handle empty candle data', () => {
      const input: any[] = [[]];
      expect(utils.mapOhlcvToCandles(input)).toEqual([
        {
          start: 0,
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          volume: 0,
        },
      ]);
    });
  });

  describe('createExchange', () => {
    const baseConfig = {
      name: 'binance' as const,
      apiKey: 'k',
      secret: 's',
      verbose: false,
      sandbox: false,
      exchangeSynchInterval: 1,
      orderSynchInterval: 1,
    };

    it('should create default exchange', () => {
      const result = utils.createExchange(baseConfig);
      expect(result).toMatchObject({ publicClient: expect.any(Object), privateClient: expect.any(Object) });
    });

    it('should create hyperliquid exchange', () => {
      const config = { ...baseConfig, name: 'hyperliquid' as const, privateKey: 'p', walletAddress: 'w' };
      const result = utils.createExchange(config);
      expect(result).toMatchObject({ publicClient: expect.any(Object), privateClient: expect.any(Object) });
    });

    it.each`
      proxy              | agentType
      ${'http://proxy'}  | ${HttpsProxyAgent}
      ${'socks://proxy'} | ${SocksProxyAgent}
    `('should use $agentType for $proxy', ({ proxy, agentType }) => {
      const result = utils.createExchange({ ...baseConfig, proxy });
      expect(result.publicClient.agent).toBeInstanceOf(agentType);
    });

    it('should not assign agent if proxy format is unknown', () => {
      const result = utils.createExchange({ ...baseConfig, proxy: 'tcp://proxy' });
      expect(result.publicClient.agent).toBeUndefined();
    });

    it('should configure sandbox', () => {
      const result = utils.createExchange({ ...baseConfig, sandbox: true });
      expect(result.publicClient).toHaveProperty('sandbox', true);
    });
  });

  describe('checkMandatoryFeatures', () => {
    const baseExchange: any = {
      name: 'ex',
      has: {
        cancelOrder: true,
        createLimitOrder: true,
        createMarketOrder: true,
        fetchBalance: true,
        fetchMyTrades: true,
        fetchOHLCV: true,
        fetchOrder: true,
        fetchTicker: true,
        fetchTickers: true,
      },
    };

    it('should pass given valid features', () => {
      expect(() => utils.checkMandatoryFeatures(baseExchange, false)).not.toThrow();
    });

    it('should throw on missing feature', () => {
      const ex = { ...baseExchange, has: { ...baseExchange.has, fetchOHLCV: false } };
      expect(() => utils.checkMandatoryFeatures(ex, false)).toThrow(/Missing fetchOHLCV/);
    });

    it('should throw on missing sandbox if requested', () => {
      const ex = { ...baseExchange, has: { ...baseExchange.has, sandbox: false } };
      expect(() => utils.checkMandatoryFeatures(ex, true)).toThrow(/Missing sandbox/);
    });

    it('should ignore sandbox missing if not requested', () => {
      const ex = { ...baseExchange, has: { ...baseExchange.has, sandbox: false } };
      expect(() => utils.checkMandatoryFeatures(ex, false)).not.toThrow();
    });
  });

  describe('isDummyExchange', () => {
    const dummy = { getExchangeName: () => 'dummy-ex', processOneMinuteBucket: () => {} };
    const paper = { getExchangeName: () => 'paper-ex', processOneMinuteBucket: () => {} };
    const real = { getExchangeName: () => 'real-ex', processOneMinuteBucket: () => {} };

    it.each`
      exchange     | expected | desc
      ${dummy}     | ${true}  | ${'dummy exchange'}
      ${paper}     | ${true}  | ${'paper exchange'}
      ${real}      | ${false} | ${'real exchange'}
      ${{}}        | ${false} | ${'empty object'}
      ${null}      | ${false} | ${'null'}
      ${undefined} | ${false} | ${'undefined'}
      ${123}       | ${false} | ${'number'}
    `('should return $expected for $desc', ({ exchange, expected }) => {
      expect(utils.isDummyExchange(exchange)).toBe(expected);
    });

    it('should return false if missing processOneMinuteBucket', () => {
      expect(utils.isDummyExchange({ getExchangeName: () => 'dummy' })).toBe(false);
    });
  });
});
