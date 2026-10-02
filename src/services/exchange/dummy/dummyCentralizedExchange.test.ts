import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { OrderSide } from '@models/order.types';
import { TradingPair } from '@models/utility.types';
import { InvalidOrder } from '@services/exchange/exchange.error';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DummyCentralizedExchange } from './dummyCentralizedExchange';
import type { DummyCentralizedExchangeConfig } from './dummyCentralizedExchange.types';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({
      pairs: [
        { symbol: 'BTC/USDT', timeframe: '1m' },
        { symbol: 'ETH/USDT', timeframe: '1m' },
      ],
      daterange: { start: '2024-01-01' },
    }),
  },
}));
vi.mock('@services/logger', () => ({ error: vi.fn() }));

const SYMBOL: `${string}/${string}` = 'BTC/USDT';
const ETH_SYMBOL: `${string}/${string}` = 'ETH/USDT';

const defaultMarketData = {
  price: { min: 1, max: 10_000 },
  amount: { min: 0.1, max: 100 },
  cost: { min: 10, max: 100_000 },
  precision: { price: 2, amount: 2 },
  fee: { maker: 0.001, taker: 0.002 },
};

const baseConfig: DummyCentralizedExchangeConfig = {
  name: 'dummy-cex',
  exchangeSynchInterval: 200,
  orderSynchInterval: 200,
  marketData: new Map([[SYMBOL, defaultMarketData]]),
  simulationBalance: new Map([
    ['BTC', 10],
    ['USDT', 50_000],
  ]),
  initialTicker: new Map([[SYMBOL, { bid: 100, ask: 101 }]]),
};

const createSimulationBalance = (btc: number, usdt: number) =>
  new Map([
    ['BTC', btc],
    ['USDT', usdt],
  ]);

const createExchange = (overrides: Partial<DummyCentralizedExchangeConfig> = {}) =>
  new DummyCentralizedExchange({ ...baseConfig, ...overrides });

const sampleCandle = (start: number, overrides: Partial<Candle> = {}): Candle => ({
  id: undefined,
  start,
  open: 100,
  high: 110,
  low: 90,
  close: 100,
  volume: 10,
  ...overrides,
});

/** Helper to create a CandleBucket for processOneMinuteBucket calls */
const createBucket = (start: number, overrides: Partial<Candle> = {}) => new Map([[SYMBOL, sampleCandle(start, overrides)]]);

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

    it('getMarketData returns configured market data', () => {
      expect(createExchange().getMarketData(SYMBOL).fee).toEqual({ maker: 0.001, taker: 0.002 });
    });
  });

  describe('fetchTicker', () => {
    it('returns initial ticker when no candles processed', async () => {
      expect(await createExchange().fetchTicker(SYMBOL)).toEqual({ bid: 100, ask: 101 });
    });

    it('returns last candle close as ticker after processing', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000, { close: 150 }));
      expect(await exchange.fetchTicker(SYMBOL)).toEqual({ bid: 150, ask: 150 });
    });
  });

  describe('fetchBalance', () => {
    it('returns initial balance', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(5, 1000) });
      const balance = await exchange.fetchBalance();
      expect(balance.get('BTC')).toEqual({ free: 5, used: 0, total: 5 });
      expect(balance.get('USDT')).toEqual({ free: 1000, used: 0, total: 1000 });
    });
  });

  describe('fetchOHLCV', () => {
    it('returns empty array when no candles', async () => {
      expect(await createExchange().fetchOHLCV(SYMBOL, {})).toEqual([]);
    });

    it('returns all candles when no from specified', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      await exchange.processOneMinuteBucket(createBucket(2000));
      expect(await exchange.fetchOHLCV(SYMBOL, {})).toHaveLength(2);
    });

    it('returns candles from specified timestamp', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      await exchange.processOneMinuteBucket(createBucket(2000));
      expect(await exchange.fetchOHLCV(SYMBOL, { from: 2000 })).toHaveLength(1);
    });

    it('returns empty when from is beyond all candles', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      expect(await exchange.fetchOHLCV(SYMBOL, { from: 9999 })).toHaveLength(0);
    });
  });

  describe('createLimitOrder', () => {
    it.each`
      side      | reserveField
      ${'BUY'}  | ${'USDT'}
      ${'SELL'} | ${'BTC'}
    `('$side order reserves $reserveField balance', async ({ side, reserveField }) => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await exchange.createLimitOrder(SYMBOL, side, 1, 100);
      const balance = await exchange.fetchBalance();
      expect(balance.get(reserveField as string)?.used).toBeGreaterThan(0);
    });

    it('throws when amount below minimum', async () => {
      await expect(createExchange().createLimitOrder(SYMBOL, 'BUY', 0.01, 100)).rejects.toBeInstanceOf(InvalidOrder);
    });

    it('throws when insufficient currency for BUY', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(0, 10) });
      await expect(exchange.createLimitOrder(SYMBOL, 'BUY', 1, 100)).rejects.toThrow('Insufficient currency');
    });

    it('throws when insufficient asset for SELL', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(0, 10000) });
      await expect(exchange.createLimitOrder(SYMBOL, 'SELL', 1, 100)).rejects.toThrow('Insufficient asset');
    });
  });

  describe('createMarketOrder', () => {
    it.each`
      side      | balanceChange
      ${'BUY'}  | ${'increases asset'}
      ${'SELL'} | ${'decreases asset'}
    `('$side order $balanceChange immediately', async ({ side }) => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const before = await exchange.fetchBalance();
      await exchange.createMarketOrder(SYMBOL, side, 1);
      const after = await exchange.fetchBalance();
      expect(after.get('BTC')?.total).not.toBe(before.get('BTC')?.total);
    });

    it('throws when insufficient currency for market BUY', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(0, 10) });
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await expect(exchange.createMarketOrder(SYMBOL, 'BUY', 1)).rejects.toThrow('Insufficient currency');
    });

    it('throws when insufficient asset for market SELL', async () => {
      const exchange = createExchange({ simulationBalance: createSimulationBalance(0, 10000) });
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await expect(exchange.createMarketOrder(SYMBOL, 'SELL', 1)).rejects.toThrow('Insufficient asset');
    });
  });

  describe('cancelOrder', () => {
    it('cancels open order and releases balance', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 100);
      const canceled = await exchange.cancelOrder(SYMBOL, order.id);
      expect(canceled.status).toBe('canceled');
    });

    it('throws when order not found', async () => {
      await expect(createExchange().cancelOrder(SYMBOL, 'unknown-id')).rejects.toThrow('Unknown order');
    });

    it('does not change already closed order', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createMarketOrder(SYMBOL, 'BUY', 1);
      const canceled = await exchange.cancelOrder(SYMBOL, order.id);
      expect(canceled.status).toBe('closed');
    });
  });

  describe('fetchOrder', () => {
    it('returns order by id', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 100);
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ id: order.id, status: 'open' });
    });

    it('throws when order not found', async () => {
      await expect(createExchange().fetchOrder(SYMBOL, 'invalid-id')).rejects.toThrow('Unknown order');
    });
  });

  describe('fetchMyTrades', () => {
    it('returns empty when no orders', async () => {
      expect(await createExchange().fetchMyTrades(SYMBOL)).toEqual([]);
    });

    it('maps filled orders to trades', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await exchange.createMarketOrder(SYMBOL, 'BUY', 1);
      const trades = await exchange.fetchMyTrades(SYMBOL);
      expect(trades).toHaveLength(1);
    });

    it('filters trades by from timestamp', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await exchange.createMarketOrder(SYMBOL, 'BUY', 1);
      const trades = await exchange.fetchMyTrades(SYMBOL, Date.now() + 1000);
      expect(trades).toHaveLength(0);
    });
  });

  describe('Order Settlement', () => {
    it('fills BUY order when candle low reaches price', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 95);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { low: 95 }));
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ status: 'closed', filled: 1 });
    });

    it('fills SELL order when candle high reaches price', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 105);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { high: 105 }));
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ status: 'closed', filled: 1 });
    });

    it('does not fill BUY order when price not reached', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 50);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { low: 80 }));
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ status: 'open' });
    });

    it('does not fill SELL order when price not reached', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      const order = await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 150);
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { high: 120 }));
      expect(await exchange.fetchOrder(SYMBOL, order.id)).toMatchObject({ status: 'open' });
    });
  });

  describe('Multi-pair isolation', () => {
    // BTC/USDT trades around 100 and ETH/USDT around 20, with different maker fees. Each bucket below starts with the other
    // pair's candle, which crosses the order price (an ETH low of 15 crosses a BTC BUY at 80, a BTC high of 110 an ETH SELL
    // at 30), so a pair-blind matcher fills the order before its own candle is even read.
    const btc = (overrides: Partial<Candle> = {}) => [SYMBOL, sampleCandle(1000, overrides)] as const;
    const eth = (overrides: Partial<Candle> = {}) =>
      [ETH_SYMBOL, sampleCandle(1000, { open: 20, high: 25, low: 15, close: 20, ...overrides })] as const;

    const createMultiPairExchange = () =>
      createExchange({
        marketData: new Map([
          [SYMBOL, defaultMarketData],
          [ETH_SYMBOL, { ...defaultMarketData, fee: { maker: 0.003, taker: 0.004 } }],
        ]),
        simulationBalance: new Map([
          ['BTC', 10],
          ['ETH', 10],
          ['USDT', 50_000],
        ]),
      });

    const settleLimitOrder = async (symbol: TradingPair, side: OrderSide, price: number, bucket: CandleBucket) => {
      const exchange = createMultiPairExchange();
      const { id } = await exchange.createLimitOrder(symbol, side, 1, price);
      await exchange.processOneMinuteBucket(bucket);
      return { order: await exchange.fetchOrder(symbol, id), balance: await exchange.fetchBalance() };
    };

    it.each`
      side      | symbol        | price | bucket
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 90 })])}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 25 })])}
    `('$side $symbol limit order stays open when only the other pair candle reaches its price', async ({ side, symbol, price, bucket }) => {
      const { order } = await settleLimitOrder(symbol, side, price, bucket);
      expect(order.status).toBe('open');
    });

    it.each`
      side      | symbol        | price | bucket                                 | asset    | total
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 75 })])}  | ${'BTC'} | ${11}
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 75 })])}  | ${'ETH'} | ${10}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 35 })])} | ${'ETH'} | ${9}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 35 })])} | ${'BTC'} | ${10}
    `('$side $symbol limit order filled by its own candle leaves $total $asset', async ({ side, symbol, price, bucket, asset, total }) => {
      const { balance } = await settleLimitOrder(symbol, side, price, bucket);
      expect(balance.get(asset)?.total).toBe(total);
    });

    it.each`
      side      | symbol        | price | bucket                                 | usdt
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 75 })])}  | ${50_000 - 80 * (1 + 0.001)}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 35 })])} | ${50_000 + 30 * (1 - 0.003)}
    `('$side $symbol limit order filled by its own candle pays its own pair maker fee', async ({ side, symbol, price, bucket, usdt }) => {
      const { balance } = await settleLimitOrder(symbol, side, price, bucket);
      expect(balance.get('USDT')?.total).toBeCloseTo(usdt, 8);
    });

    it.each`
      side      | symbol        | price | bucket                                 | reserved
      ${'BUY'}  | ${SYMBOL}     | ${80} | ${new Map([eth(), btc({ low: 75 })])}  | ${'USDT'}
      ${'SELL'} | ${ETH_SYMBOL} | ${30} | ${new Map([btc(), eth({ high: 35 })])} | ${'ETH'}
    `(
      '$side $symbol limit order filled by its own candle releases its $reserved reservation',
      async ({ side, symbol, price, bucket, reserved }) => {
        const { balance } = await settleLimitOrder(symbol, side, price, bucket);
        expect(balance.get(reserved)?.used).toBe(0);
      },
    );

    it('cancelOrder releases the reservation on the pair of the order, whatever symbol it is given', async () => {
      const exchange = createMultiPairExchange();
      const { id } = await exchange.createLimitOrder(ETH_SYMBOL, 'SELL', 1, 30);
      await exchange.cancelOrder(SYMBOL, id);
      const balance = await exchange.fetchBalance();
      expect(balance.get('ETH')?.used).toBe(0);
    });

    it('fetchMyTrades without from only returns the trades of the requested pair', async () => {
      const exchange = createMultiPairExchange();
      await exchange.processOneMinuteBucket(new Map([btc(), eth()]));
      await exchange.createMarketOrder(SYMBOL, 'BUY', 1);
      await exchange.createMarketOrder(ETH_SYMBOL, 'BUY', 1);
      expect(await exchange.fetchMyTrades(SYMBOL)).toHaveLength(1);
    });
  });

  describe('processOneMinuteBucket', () => {
    it('updates ticker with candle close', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000, { close: 200 }));
      expect(await exchange.fetchTicker(SYMBOL)).toEqual({ bid: 200, ask: 200 });
    });

    it('adds candle to OHLCV history', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(1000));
      expect(await exchange.fetchOHLCV(SYMBOL, {})).toHaveLength(1);
    });
  });

  describe('Order Insertion and Sorting', () => {
    it('maintains BUY orders in descending price order', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 80);
      await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 90);
      await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 85);
      // Fill all at once
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { low: 75 }));
      const trades = await exchange.fetchMyTrades(SYMBOL);
      expect(trades).toHaveLength(3);
    });

    it('maintains SELL orders in ascending price order', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 120);
      await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 110);
      await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 115);
      // Fill all at once
      await exchange.processOneMinuteBucket(createBucket(Date.now(), { high: 125 }));
      const trades = await exchange.fetchMyTrades(SYMBOL);
      expect(trades).toHaveLength(3);
    });

    it('handles inserting order at beginning of sorted BUY list', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 80);
      await exchange.createLimitOrder(SYMBOL, 'BUY', 1, 95); // Higher price, goes first
      const balance = await exchange.fetchBalance();
      expect(balance.get('USDT')?.used).toBeGreaterThan(0);
    });

    it('handles inserting order at end of sorted SELL list', async () => {
      const exchange = createExchange();
      await exchange.processOneMinuteBucket(createBucket(Date.now() - 60_000));
      await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 110);
      await exchange.createLimitOrder(SYMBOL, 'SELL', 1, 120); // Higher price, goes last
      const balance = await exchange.fetchBalance();
      expect(balance.get('BTC')?.used).toBeGreaterThan(0);
    });
  });
});
