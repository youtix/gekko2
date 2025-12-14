import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Candle } from '@models/candle.types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DummyCentralizedExchange } from './dummyCentralizedExchange';
import type { DummyCentralizedExchangeConfig } from './dummyCentralizedExchange.types';

const mockStartDate = '2024-01-01T00:00:00Z';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({
      asset: 'BTC',
      currency: 'USDT',
      timeframe: '1m',
      daterange: { start: mockStartDate },
    }),
    getExchange: () => ({ name: 'dummy', exchangeSynchInterval: 5, orderSynchInterval: 1 }),
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
    precision: {
      price: 2,
      amount: 2,
    },
    fee: {
      maker: 0.0015,
      taker: 0.0025,
    },
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
  close: 10,
  volume: 10,
  ...overrides,
});

const seedExchangeWithBaseCandle = async (exchange: DummyCentralizedExchange, overrides: Partial<Candle> = {}) => {
  const candle = sampleCandle(Date.now() - 60_000, overrides);
  await exchange.processOneMinuteCandle(candle);
  return candle;
};

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
      marketData: {
        price: { min: 2, max: 500 },
        amount: { min: 0.5, max: 5 },
        cost: { min: 20, max: 10_000 },
        precision: {
          price: 2,
          amount: 2,
        },
        fee: {
          maker: 0.15,
          taker: 0.25,
        },
      },
      initialTicker: { bid: 200, ask: 201 },
    });

    await exchange.loadMarkets();

    await expect(exchange.fetchBalance()).resolves.toEqual({
      asset: { free: 1, used: 0, total: 1 },
      currency: { free: 1_000, used: 0, total: 1_000 },
    });
    await expect(exchange.fetchTicker()).resolves.toEqual({ bid: 200, ask: 201 });
    await expect(exchange.fetchOHLCV({})).resolves.toEqual([]);
  });

  it('manages order lifecycle including reservation, fill, and cancellation', async () => {
    const exchange = createExchange({ simulationBalance: { asset: 2, currency: 1_000 } });
    await exchange.loadMarkets();
    await seedExchangeWithBaseCandle(exchange);

    const buyOrder = await exchange.createLimitOrder('BUY', 1, 100);
    const makerFeeRate = baseConfig.marketData.fee.maker ?? 0;
    const reservedPortfolio = await exchange.fetchBalance();
    expect(reservedPortfolio.currency.total).toBe(1_000);
    expect(reservedPortfolio.currency.free).toBeCloseTo(1_000 - (buyOrder.price ?? 0) * (1 + makerFeeRate));
    expect(reservedPortfolio.asset.total).toBe(2);

    const fillCandle = sampleCandle(Date.now(), {
      low: buyOrder.price ?? 0,
      high: buyOrder.price ?? 0,
      close: buyOrder.price ?? 0,
    });
    await exchange.processOneMinuteCandle(fillCandle);

    const filledOrder = await exchange.fetchOrder(buyOrder.id);
    expect(filledOrder.status).toBe('closed');
    expect(filledOrder.remaining).toBe(0);
    expect(filledOrder.filled).toBe(1);

    const portfolioAfterFill = await exchange.fetchBalance();
    expect(portfolioAfterFill.asset.total).toBeCloseTo(3);
    expect(portfolioAfterFill.currency.total).toBeCloseTo(1_000 - (buyOrder.price ?? 0) * (1 + makerFeeRate));

    const sellOrder = await exchange.createLimitOrder('SELL', 1, 100);
    const reservedAfterSell = await exchange.fetchBalance();
    expect(reservedAfterSell.asset.total).toBeCloseTo(3);
    expect(reservedAfterSell.asset.free).toBeCloseTo(2);

    const canceled = await exchange.cancelOrder(sellOrder.id);
    expect(canceled.status).toBe('canceled');

    const restoredPortfolio = await exchange.fetchBalance();
    expect(restoredPortfolio.asset.total).toBeCloseTo(3);
  });

  it('validates limits and cost before creating orders', async () => {
    const exchange = createExchange({ marketData: baseConfig.marketData });
    await exchange.loadMarkets();

    await expect(exchange.createLimitOrder('BUY', 0.01, 100)).rejects.toBeInstanceOf(OrderOutOfRangeError);

    const tickerSpy = vi.spyOn(exchange as unknown as { fetchTicker: () => Promise<never> }, 'fetchTicker');
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
    await seedExchangeWithBaseCandle(exchange);

    const initialPortfolio = await exchange.fetchBalance();
    const takerFeeRate = baseConfig.marketData.fee.taker ?? 0;
    const { ask, bid } = await exchange.fetchTicker();

    const buyOrder = await exchange.createMarketOrder('BUY', 2);
    expect(buyOrder.status).toBe('closed');
    expect(buyOrder.remaining).toBe(0);

    const afterBuy = await exchange.fetchBalance();
    const expectedBuyCurrency = initialPortfolio.currency.total - 2 * ask * (1 + takerFeeRate);
    expect(afterBuy.asset.total).toBeCloseTo(initialPortfolio.asset.total + 2, 8);
    expect(afterBuy.currency.total).toBeCloseTo(expectedBuyCurrency, 8);

    const sellOrder = await exchange.createMarketOrder('SELL', 1);
    expect(sellOrder.status).toBe('closed');

    const afterSell = await exchange.fetchBalance();
    const expectedSellCurrency = expectedBuyCurrency + 1 * bid * (1 - takerFeeRate);
    expect(afterSell.asset.total).toBeCloseTo(initialPortfolio.asset.total + 1, 8);
    expect(afterSell.currency.total).toBeCloseTo(expectedSellCurrency, 8);

    const trades = await exchange.fetchMyTrades();
    expect(trades).toHaveLength(2);
    expect(trades[0]?.fee?.rate).toBeCloseTo((baseConfig.marketData.fee.taker ?? 0) * 100);
    expect(trades[1]?.fee?.rate).toBeCloseTo((baseConfig.marketData.fee.taker ?? 0) * 100);
  });

  it('rejects market buy orders when balance cannot cover taker fees', async () => {
    const exchange = createExchange({
      simulationBalance: { asset: 0, currency: 100 },
    });
    await exchange.loadMarkets();
    await seedExchangeWithBaseCandle(exchange, { close: 100, low: 100, high: 100 });

    await expect(exchange.createMarketOrder('BUY', 1)).rejects.toThrow('Insufficient currency balance');
  });

  it('applies maker fees when settling limit orders', async () => {
    const exchange = createExchange({ simulationBalance: { asset: 5, currency: 10_000 } });
    await exchange.loadMarkets();
    await seedExchangeWithBaseCandle(exchange);

    const makerFeeRate = baseConfig.marketData.fee.maker ?? 0;

    const buyOrder = await exchange.createLimitOrder('BUY', 2, 100);
    const buyPrice = buyOrder.price ?? 0;
    const buyCost = buyPrice * 2;

    const afterBuyReservation = await exchange.fetchBalance();
    expect(afterBuyReservation.currency.total).toBe(10_000);
    expect(afterBuyReservation.currency.free).toBeCloseTo(10_000 - buyCost * (1 + makerFeeRate));
    expect(afterBuyReservation.asset.total).toBeCloseTo(5);

    const buyFillCandle = sampleCandle(Date.now(), {
      low: buyPrice,
      high: buyPrice,
      close: buyPrice,
    });
    await exchange.processOneMinuteCandle(buyFillCandle);

    const afterBuyFill = await exchange.fetchBalance();
    expect(afterBuyFill.asset.total).toBeCloseTo(7);
    expect(afterBuyFill.currency.total).toBeCloseTo(10_000 - buyCost * (1 + makerFeeRate));

    const sellOrder = await exchange.createLimitOrder('SELL', 1, 100);
    const sellPrice = sellOrder.price ?? 0;
    const afterSellReservation = await exchange.fetchBalance();
    expect(afterSellReservation.asset.total).toBeCloseTo(7);
    expect(afterSellReservation.asset.free).toBeCloseTo(6);
    expect(afterSellReservation.currency.total).toBeCloseTo(10_000 - buyCost * (1 + makerFeeRate));

    const sellFillCandle = sampleCandle(Date.now() + 60_000, {
      high: sellPrice,
      low: sellPrice,
      close: sellPrice,
    });
    await exchange.processOneMinuteCandle(sellFillCandle);

    const afterSellFill = await exchange.fetchBalance();
    const expectedCurrencyAfterSell = 10_000 - buyCost * (1 + makerFeeRate) + sellPrice * (1 - makerFeeRate);
    expect(afterSellFill.asset.total).toBeCloseTo(6);
    expect(afterSellFill.currency.total).toBeCloseTo(expectedCurrencyAfterSell);

    const trades = await exchange.fetchMyTrades();
    expect(trades).toHaveLength(2);
    expect(trades[0]?.fee?.rate).toBeCloseTo((baseConfig.marketData.fee.maker ?? 0) * 100);
    expect(trades[1]?.fee?.rate).toBeCloseTo((baseConfig.marketData.fee.maker ?? 0) * 100);
  });

  it('derives candles from trades when queue is empty', async () => {
    const exchange = createExchange();
    await exchange.loadMarkets();
    await seedExchangeWithBaseCandle(exchange);

    const order = await exchange.createLimitOrder('BUY', 0.5, 100);
    const candle = sampleCandle(Date.now(), {
      low: order.price ?? 0,
      high: order.price ?? 0,
      close: order.price ?? 0,
    });
    await exchange.processOneMinuteCandle(candle);

    const unsubscribe = exchange.onNewCandle(() => {});
    vi.advanceTimersByTime(baseConfig.exchangeSynchInterval ?? 0);
    unsubscribe();

    const derived = await exchange.fetchOHLCV({});
    expect(derived).not.toHaveLength(0);

    const trades = await exchange.fetchMyTrades();
    expect(trades).toHaveLength(1);
  });

  it('aligns order timestamps with candle closes and simulated time', async () => {
    const exchange = createExchange();
    await exchange.loadMarkets();
    const firstCandle = await seedExchangeWithBaseCandle(exchange);

    const limitOrder = await exchange.createLimitOrder('BUY', 1, 100);
    expect(limitOrder.timestamp).toBe(firstCandle.start + 60_000);

    const fillCandle = sampleCandle(firstCandle.start + 60_000, {
      low: limitOrder.price ?? 0,
      high: limitOrder.price ?? 0,
      close: limitOrder.price ?? 0,
    });
    await exchange.processOneMinuteCandle(fillCandle);

    const closedOrder = await exchange.fetchOrder(limitOrder.id);
    expect(closedOrder.timestamp).toBe(fillCandle.start + 60_000);

    const orderToCancel = await exchange.createLimitOrder('SELL', 1, 110);
    const canceledOrder = await exchange.cancelOrder(orderToCancel.id);
    expect(canceledOrder.timestamp).toBe(fillCandle.start + 60_000);
  });
});
