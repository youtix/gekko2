import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Candle } from '@models/candle.types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DummyCentralizedExchange } from './dummyCentralizedExchange';
import type { DummyCentralizedExchangeConfig } from './dummyCentralizedExchange.types';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({ asset: 'BTC', currency: 'USDT', timeframe: '1m' }),
  },
}));

const baseConfig: DummyCentralizedExchangeConfig = {
  name: 'dummy-cex',
  interval: 200,
  sandbox: false,
  verbose: false,
  feeMaker: 0.15,
  feeTaker: 0.25,
  limits: {
    price: { min: 1, max: 10_000 },
    amount: { min: 0.1, max: 100 },
    cost: { min: 10, max: 100_000 },
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
  close: 105,
  volume: 10,
  ...overrides,
});

describe('DummyCentralizedExchange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads markets with provided overrides and exposes portfolio and ticker', async () => {
    const exchange = createExchange({
      simulationBalance: { asset: 1, currency: 1_000 },
      limits: {
        price: { min: 2, max: 500 },
        amount: { min: 0.5, max: 5 },
        cost: { min: 20, max: 10_000 },
      },
      initialTicker: { bid: 200, ask: 201 },
    });

    await exchange.loadMarkets();

    await expect(exchange.fetchPortfolio()).resolves.toEqual({ asset: 1, currency: 1_000 });
    await expect(exchange.fetchTicker()).resolves.toEqual({ bid: 200, ask: 201 });
    await expect(exchange.getKlines()).resolves.toEqual([]);
  });

  it('manages order lifecycle including reservation, fill, and cancellation', async () => {
    const exchange = createExchange({ simulationBalance: { asset: 2, currency: 1_000 } });
    await exchange.loadMarkets();

    const buyOrder = await exchange.createLimitOrder('BUY', 1);
    const reservedPortfolio = await exchange.fetchPortfolio();
    expect(reservedPortfolio.currency).toBeCloseTo(1_000 - (buyOrder.price ?? 0));
    expect(reservedPortfolio.asset).toBe(2);

    const fillCandle = sampleCandle(Date.now(), {
      low: buyOrder.price ?? 0,
      high: buyOrder.price ?? 0,
      close: buyOrder.price ?? 0,
    });
    exchange.addCandle(fillCandle);

    const filledOrder = await exchange.fetchOrder(buyOrder.id);
    expect(filledOrder.status).toBe('closed');
    expect(filledOrder.remaining).toBe(0);
    expect(filledOrder.filled).toBe(1);

    const portfolioAfterFill = await exchange.fetchPortfolio();
    expect(portfolioAfterFill.asset).toBeCloseTo(3);

    const sellOrder = await exchange.createLimitOrder('SELL', 1);
    const reservedAfterSell = await exchange.fetchPortfolio();
    expect(reservedAfterSell.asset).toBeCloseTo(2);

    const canceled = await exchange.cancelOrder(sellOrder.id);
    expect(canceled.status).toBe('canceled');

    const restoredPortfolio = await exchange.fetchPortfolio();
    expect(restoredPortfolio.asset).toBeCloseTo(3);
  });

  it('validates limits and cost before creating orders', async () => {
    const exchange = createExchange({ limits: baseConfig.limits });
    await exchange.loadMarkets();

    await expect(exchange.createLimitOrder('BUY', 0.01)).rejects.toBeInstanceOf(OrderOutOfRangeError);

    const tickerSpy = vi.spyOn(exchange as unknown as { fetchTickerImpl: () => Promise<never> }, 'fetchTickerImpl');
    tickerSpy.mockImplementation(async () => {
      throw new Error('ticker unavailable');
    });

    await expect(exchange.fetchTicker()).rejects.toThrow('ticker unavailable');
    expect(tickerSpy).toHaveBeenCalledTimes(1);
    tickerSpy.mockRestore();
  });

  it('executes market orders immediately and applies taker fees to balances', async () => {
    const exchange = createExchange();
    await exchange.loadMarkets();

    const initialPortfolio = await exchange.fetchPortfolio();
    const takerFeeRate = baseConfig.feeTaker ?? 0;

    const buyOrder = await exchange.createMarketOrder('BUY', 2);
    expect(buyOrder.status).toBe('closed');
    expect(buyOrder.remaining).toBe(0);

    const afterBuy = await exchange.fetchPortfolio();
    const expectedBuyCurrency = initialPortfolio.currency - 2 * baseConfig.initialTicker.ask * (1 + takerFeeRate);
    expect(afterBuy.asset).toBeCloseTo(initialPortfolio.asset + 2, 8);
    expect(afterBuy.currency).toBeCloseTo(expectedBuyCurrency, 8);

    const sellOrder = await exchange.createMarketOrder('SELL', 1);
    expect(sellOrder.status).toBe('closed');

    const afterSell = await exchange.fetchPortfolio();
    const expectedSellCurrency = expectedBuyCurrency + 1 * baseConfig.initialTicker.bid * (1 - takerFeeRate);
    expect(afterSell.asset).toBeCloseTo(initialPortfolio.asset + 1, 8);
    expect(afterSell.currency).toBeCloseTo(expectedSellCurrency, 8);

    const trades = await exchange.fetchTrades();
    expect(trades).toHaveLength(2);
    expect(trades[0]?.fee?.rate).toBeCloseTo(baseConfig.feeTaker);
    expect(trades[1]?.fee?.rate).toBeCloseTo(baseConfig.feeTaker);
  });

  it('derives candles from trades when queue is empty', async () => {
    const exchange = createExchange();
    await exchange.loadMarkets();

    const order = await exchange.createLimitOrder('BUY', 0.5);
    const candle = sampleCandle(Date.now(), {
      low: order.price ?? 0,
      high: order.price ?? 0,
      close: order.price ?? 0,
    });
    exchange.addCandle(candle);

    const unsubscribe = exchange.onNewCandle(() => {});
    vi.advanceTimersByTime(baseConfig.interval ?? 0);
    unsubscribe();

    const derived = await exchange.getKlines(undefined, '1m');
    expect(derived).not.toHaveLength(0);

    const trades = await exchange.fetchTrades();
    expect(trades).toHaveLength(1);
  });
});
