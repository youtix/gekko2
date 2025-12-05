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
      maker: 0,
      taker: 0,
    },
  },
  simulationBalance: { asset: 10, currency: 1000 },
  initialTicker: { bid: 100, ask: 101 },
};

const createExchange = (overrides: Partial<DummyCentralizedExchangeConfig> = {}) =>
  new DummyCentralizedExchange({ ...baseConfig, ...overrides });

describe('DummyCentralizedExchange Concurrency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle concurrent limit orders correctly', async () => {
    const exchange = createExchange({
      simulationBalance: { asset: 0, currency: 1000 },
    });
    await exchange.loadMarkets();

    // Try to create 5 orders of 200 currency each. Total 1000.
    // If race condition exists, it might allow more than 1000 to be reserved if checks happen before deduction.
    // With PromiseQueue, they should be sequential.
    const promises = Array.from({ length: 5 }).map(() => exchange.createLimitOrder('BUY', 2, 100));

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(0);

    const portfolio = await exchange.fetchBalance();
    expect(portfolio.currency).toBe(0);
  });

  it('should prevent overspending with concurrent orders', async () => {
    const exchange = createExchange({
      simulationBalance: { asset: 0, currency: 1000 },
    });
    await exchange.loadMarkets();

    // Try to create 6 orders of 200 currency each. Total 1200.
    // Should allow 5, reject 1.
    const promises = Array.from({ length: 6 }).map(() => exchange.createLimitOrder('BUY', 2, 100));

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(1);

    const portfolio = await exchange.fetchBalance();
    expect(portfolio.currency).toBe(0);
  });
});
