import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Candle } from '@models/candle.types';
import { Portfolio } from '@models/portfolio.types';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DummyExchange, DummyExchangeConfig } from './dummy';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({ asset: 'ETH', currency: 'USDT', timeframe: '1m' }),
  },
}));

describe('DummyExchange', () => {
  const baseConfig: DummyExchangeConfig = {
    name: 'dummy-dex',
    interval: 200,
    sandbox: false,
    verbose: false,
    limits: {
      price: { min: 1, max: 1_000 },
      amount: { min: 0.1, max: 10 },
      cost: { min: 10, max: 100_000 },
    },
    portfolio: { asset: 5, currency: 10_000 },
    initialTicker: { bid: 100, ask: 101 },
    candleTimeframe: '1m',
  };

  const createExchange = (overrides: Partial<DummyExchangeConfig> = {}) =>
    new DummyExchange({ ...baseConfig, ...overrides });

  const sampleCandle = (start: number, overrides: Partial<Candle> = {}): Candle => ({
    start,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 10,
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads markets with custom limits and validates amount bounds', async () => {
    const exchange = createExchange({
      limits: {
        price: { min: 5, max: 500 },
        amount: { min: 2, max: 5 },
        cost: { min: 50, max: 10_000 },
      },
    });

    await exchange.loadMarkets();
    await expect(exchange.createLimitOrder('buy', 1)).rejects.toBeInstanceOf(OrderOutOfRangeError);

    const order = await exchange.createLimitOrder('buy', 2);
    expect(order.status).toBe('open');
    expect(order.remaining).toBe(2);
  });

  it('fills limit orders when price crosses, records trades, and updates portfolio', async () => {
    const exchange = createExchange({ portfolio: { asset: 0, currency: 10_000 } });
    await exchange.loadMarkets();

    const order = await exchange.createLimitOrder('buy', 1);
    const reservedPortfolio = await exchange.fetchPortfolio();
    expect(reservedPortfolio.currency).toBeCloseTo(10_000 - (order.price ?? 0));
    expect(reservedPortfolio.asset).toBe(0);

    const candle = sampleCandle(Date.now(), { low: order.price ?? 0, close: order.price ?? 0 });
    exchange.addCandle(candle);

    const fetchedOrder = await exchange.fetchOrder(order.id);
    expect(fetchedOrder.status).toBe('closed');
    expect(fetchedOrder.remaining).toBe(0);
    expect(fetchedOrder.filled).toBe(1);

    const trades = await exchange.fetchMyTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ amount: 1, price: order.price });

    const portfolio = await exchange.fetchPortfolio();
    expect(portfolio.asset).toBeCloseTo(1);
    expect(portfolio.currency).toBeCloseTo(10_000 - (order.price ?? 0));
  });

  it('cancels open orders and restores reserved balances', async () => {
    const initialPortfolio: Portfolio = { asset: 5, currency: 1_000 };
    const exchange = createExchange({ portfolio: initialPortfolio });
    await exchange.loadMarkets();

    const order = await exchange.createLimitOrder('sell', 2);
    const reserved = await exchange.fetchPortfolio();
    expect(reserved.asset).toBeCloseTo(initialPortfolio.asset - 2);

    const canceled = await exchange.cancelLimitOrder(order.id);
    expect(canceled.status).toBe('canceled');
    expect(canceled.remaining).toBe(0);

    const portfolio = await exchange.fetchPortfolio();
    expect(portfolio).toEqual(initialPortfolio);
  });

  it('returns candles filtered by timeframe and query parameters', async () => {
    const exchange = createExchange();
    await exchange.loadMarkets();

    const baseTime = Date.now();
    exchange.addCandle(sampleCandle(baseTime, { close: 101 }), '1m');
    exchange.addCandle(sampleCandle(baseTime + 60_000, { close: 102 }), '1m');
    exchange.addCandle(sampleCandle(baseTime, { close: 200 }), '5m');

    const oneMinuteCandles = await exchange.getKlines(undefined, '1m');
    expect(oneMinuteCandles).toHaveLength(2);
    expect(oneMinuteCandles[0].close).toBe(101);

    const filtered = await exchange.getKlines(baseTime + 30_000, '1m');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].close).toBe(102);

    const limited = await exchange.getKlines(undefined, '1m', 1);
    expect(limited).toHaveLength(1);
    expect(limited[0].close).toBe(102);

    const fiveMinuteCandles = await exchange.getKlines(undefined, '5m');
    expect(fiveMinuteCandles).toHaveLength(1);
    expect(fiveMinuteCandles[0].close).toBe(200);
  });

  it('emits candles via polling and cleans up listeners', async () => {
    const exchange = createExchange();
    await exchange.loadMarkets();

    const emitted: Candle[] = [];
    const unsubscribe = exchange.onNewCandle(candle => emitted.push(candle));

    const first = sampleCandle(Date.now(), { close: 120 });
    const second = sampleCandle(Date.now() + 60_000, { close: 121 });
    exchange.addCandle(first);
    exchange.addCandle(second);

    const interval = baseConfig.interval ?? 0;
    vi.advanceTimersByTime(interval * 2 + 10);
    expect(emitted).toHaveLength(2);
    expect(emitted[0].close).toBe(120);
    expect(emitted[1].close).toBe(121);

    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);

    const third = sampleCandle(Date.now() + 120_000, { close: 130 });
    exchange.addCandle(third);
    vi.advanceTimersByTime(interval + 10);
    expect(emitted).toHaveLength(2);
  });
});
