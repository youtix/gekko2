import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Candle } from '@models/candle.types';
import { Portfolio } from '@models/portfolio.types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DummyCentralizedExchange } from './dummyCentralizedExchange';
import type { DummyCentralizedExchangeConfig } from './dummyCentralizedExchange.types';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({ asset: 'BTC', currency: 'USDT', timeframe: '1m', daterange: { start: '2024-01-01' } }),
  },
}));
vi.mock('@services/logger', () => ({ error: vi.fn() }));

const baseConfig: DummyCentralizedExchangeConfig = {
  name: 'dummy-cex',
  exchangeSynchInterval: 200,
  orderSynchInterval: 200,
  marketData: {
    price: { min: 1, max: 10_000 },
    amount: { min: 0.1, max: 100 },
    cost: { min: 10, max: 100_000 },
    precision: { price: 2, amount: 2 },
    fee: { maker: 0.001, taker: 0.002 },
  },
  simulationBalance: { asset: 10, currency: 50_000 },
  initialTicker: { bid: 100, ask: 101 },
};

const createExchange = (overrides: Partial<DummyCentralizedExchangeConfig> = {}) =>
  new DummyCentralizedExchange({ ...baseConfig, ...overrides });

const sampleCandle = (start: number, overrides: Partial<Candle> = {}): Candle => ({
  start,
  open: 100,
  high: 110,
  low: 90,
  close: 100,
  volume: 10,
  ...overrides,
});

describe('DummyCentralizedExchange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Constructor and Basic Methods', () => {
    it('returns dummy-cex as exchange name', () => {
      expect(createExchange().getExchangeName()).toBe('dummy-cex');
    });

    it('loadMarkets resolves immediately', async () => {
      await expect(createExchange().loadMarkets()).resolves.toBeUndefined();
    });

    it('onNewCandle returns a noop unsubscribe function', () => {
      const unsubscribe = createExchange().onNewCandle(vi.fn());
      expect(typeof unsubscribe).toBe('function');
    });

    it('getMarketData returns configured market data', () => {
      expect(createExchange().getMarketData().fee).toEqual({ maker: 0.001, taker: 0.002 });
    });
  });

  describe('fetchTicker', () => {
    it('returns initial ticker when no candles processed', async () => {
      expect(await createExchange().fetchTicker()).toEqual({ bid: 100, ask: 101 });
    });

    it('returns last candle close as ticker after processing', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000, { close: 150 }));
      expect(await exchange.fetchTicker()).toEqual({ bid: 150, ask: 150 });
    });
  });

  describe('fetchBalance', () => {
    it('returns initial balance', async () => {
      const exchange = createExchange({ simulationBalance: { asset: 5, currency: 1000 } });
      expect(await exchange.fetchBalance()).toEqual({
        asset: { free: 5, used: 0, total: 5 },
        currency: { free: 1000, used: 0, total: 1000 },
      });
    });
  });

  describe('fetchOHLCV', () => {
    it('returns empty array when no candles', async () => {
      expect(await createExchange().fetchOHLCV({})).toEqual([]);
    });

    it('returns all candles when no from specified', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(1000));
      await exchange.processOneMinuteCandle(sampleCandle(2000));
      expect(await exchange.fetchOHLCV({})).toHaveLength(2);
    });

    it('returns candles from specified timestamp', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(1000));
      await exchange.processOneMinuteCandle(sampleCandle(2000));
      expect(await exchange.fetchOHLCV({ from: 2000 })).toHaveLength(1);
    });

    it('returns empty when from is beyond all candles', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(1000));
      expect(await exchange.fetchOHLCV({ from: 9999 })).toHaveLength(0);
    });
  });

  describe('createLimitOrder', () => {
    it.each`
      side      | reserveField
      ${'BUY'}  | ${'currency'}
      ${'SELL'} | ${'asset'}
    `('$side order reserves $reserveField balance', async ({ side, reserveField }) => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await exchange.createLimitOrder(side, 1, 100);
      const balance = await exchange.fetchBalance();
      expect(balance[reserveField as keyof Portfolio].used).toBeGreaterThan(0);
    });

    it('throws when amount below minimum', async () => {
      await expect(createExchange().createLimitOrder('BUY', 0.01, 100)).rejects.toBeInstanceOf(OrderOutOfRangeError);
    });

    it('throws when insufficient currency for BUY', async () => {
      const exchange = createExchange({ simulationBalance: { asset: 0, currency: 10 } });
      await expect(exchange.createLimitOrder('BUY', 1, 100)).rejects.toThrow('Insufficient currency');
    });

    it('throws when insufficient asset for SELL', async () => {
      const exchange = createExchange({ simulationBalance: { asset: 0, currency: 10000 } });
      await expect(exchange.createLimitOrder('SELL', 1, 100)).rejects.toThrow('Insufficient asset');
    });
  });

  describe('createMarketOrder', () => {
    it.each`
      side      | balanceChange
      ${'BUY'}  | ${'increases asset'}
      ${'SELL'} | ${'decreases asset'}
    `('$side order $balanceChange immediately', async ({ side }) => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      const before = await exchange.fetchBalance();
      await exchange.createMarketOrder(side, 1);
      const after = await exchange.fetchBalance();
      expect(after.asset.total).not.toBe(before.asset.total);
    });

    it('throws when insufficient currency for market BUY', async () => {
      const exchange = createExchange({ simulationBalance: { asset: 0, currency: 10 } });
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await expect(exchange.createMarketOrder('BUY', 1)).rejects.toThrow('Insufficient currency');
    });

    it('throws when insufficient asset for market SELL', async () => {
      const exchange = createExchange({ simulationBalance: { asset: 0, currency: 10000 } });
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await expect(exchange.createMarketOrder('SELL', 1)).rejects.toThrow('Insufficient asset');
    });
  });

  describe('cancelOrder', () => {
    it('cancels open order and releases balance', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      const order = await exchange.createLimitOrder('BUY', 1, 100);
      const canceled = await exchange.cancelOrder(order.id);
      expect(canceled.status).toBe('canceled');
    });

    it('throws when order not found', async () => {
      await expect(createExchange().cancelOrder('unknown-id')).rejects.toThrow('Unknown order');
    });

    it('does not change already closed order', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      const order = await exchange.createMarketOrder('BUY', 1);
      const canceled = await exchange.cancelOrder(order.id);
      expect(canceled.status).toBe('closed');
    });
  });

  describe('fetchOrder', () => {
    it('returns order by id', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      const order = await exchange.createLimitOrder('BUY', 1, 100);
      expect(await exchange.fetchOrder(order.id)).toMatchObject({ id: order.id, status: 'open' });
    });

    it('throws when order not found', async () => {
      await expect(createExchange().fetchOrder('invalid-id')).rejects.toThrow('Unknown order');
    });
  });

  describe('fetchMyTrades', () => {
    it('returns empty when no orders', async () => {
      expect(await createExchange().fetchMyTrades()).toEqual([]);
    });

    it('maps filled orders to trades', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await exchange.createMarketOrder('BUY', 1);
      const trades = await exchange.fetchMyTrades();
      expect(trades).toHaveLength(1);
    });

    it('filters trades by from timestamp', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await exchange.createMarketOrder('BUY', 1);
      const trades = await exchange.fetchMyTrades(Date.now() + 1000);
      expect(trades).toHaveLength(0);
    });
  });

  describe('Order Settlement', () => {
    it('fills BUY order when candle low reaches price', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      const order = await exchange.createLimitOrder('BUY', 1, 95);
      await exchange.processOneMinuteCandle(sampleCandle(Date.now(), { low: 95 }));
      expect(await exchange.fetchOrder(order.id)).toMatchObject({ status: 'closed', filled: 1 });
    });

    it('fills SELL order when candle high reaches price', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      const order = await exchange.createLimitOrder('SELL', 1, 105);
      await exchange.processOneMinuteCandle(sampleCandle(Date.now(), { high: 105 }));
      expect(await exchange.fetchOrder(order.id)).toMatchObject({ status: 'closed', filled: 1 });
    });

    it('does not fill BUY order when price not reached', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      const order = await exchange.createLimitOrder('BUY', 1, 50);
      await exchange.processOneMinuteCandle(sampleCandle(Date.now(), { low: 80 }));
      expect(await exchange.fetchOrder(order.id)).toMatchObject({ status: 'open' });
    });

    it('does not fill SELL order when price not reached', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      const order = await exchange.createLimitOrder('SELL', 1, 150);
      await exchange.processOneMinuteCandle(sampleCandle(Date.now(), { high: 120 }));
      expect(await exchange.fetchOrder(order.id)).toMatchObject({ status: 'open' });
    });
  });

  describe('processOneMinuteCandle', () => {
    it('updates ticker with candle close', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(1000, { close: 200 }));
      expect(await exchange.fetchTicker()).toEqual({ bid: 200, ask: 200 });
    });

    it('adds candle to OHLCV history', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(1000));
      expect(await exchange.fetchOHLCV({})).toHaveLength(1);
    });
  });

  describe('Order Insertion and Sorting', () => {
    it('maintains BUY orders in descending price order', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await exchange.createLimitOrder('BUY', 1, 80);
      await exchange.createLimitOrder('BUY', 1, 90);
      await exchange.createLimitOrder('BUY', 1, 85);
      // Fill all at once
      await exchange.processOneMinuteCandle(sampleCandle(Date.now(), { low: 75 }));
      const trades = await exchange.fetchMyTrades();
      expect(trades).toHaveLength(3);
    });

    it('maintains SELL orders in ascending price order', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await exchange.createLimitOrder('SELL', 1, 120);
      await exchange.createLimitOrder('SELL', 1, 110);
      await exchange.createLimitOrder('SELL', 1, 115);
      // Fill all at once
      await exchange.processOneMinuteCandle(sampleCandle(Date.now(), { high: 125 }));
      const trades = await exchange.fetchMyTrades();
      expect(trades).toHaveLength(3);
    });

    it('handles inserting order at beginning of sorted BUY list', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await exchange.createLimitOrder('BUY', 1, 80);
      await exchange.createLimitOrder('BUY', 1, 95); // Higher price, goes first
      expect(await exchange.fetchBalance()).toMatchObject({ currency: { used: expect.any(Number) } });
    });

    it('handles inserting order at end of sorted SELL list', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteCandle(sampleCandle(Date.now() - 60_000));
      await exchange.createLimitOrder('SELL', 1, 110);
      await exchange.createLimitOrder('SELL', 1, 120); // Higher price, goes last
      expect(await exchange.fetchBalance()).toMatchObject({ asset: { used: expect.any(Number) } });
    });
  });
});
