import { Candle } from '@models/candle.types';
import { bench, describe, vi } from 'vitest';
import { DummyCentralizedExchange } from './dummyCentralizedExchange';
import { DEFAULT_MARKET_DATA, DEFAULT_TICKER } from './dummyCentralizedExchange.const';
import { DummyCentralizedExchangeConfig } from './dummyCentralizedExchange.types';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(() => ({
      daterange: {
        start: '2020-01-01T00:00:00Z',
        end: '2020-01-02T00:00:00Z',
      },
    })),
  },
}));

describe('DummyCentralizedExchange Benchmarks', async () => {
  const exchangeConfig = {
    name: 'dummy-cex',
    simulationBalance: { asset: 1000000, currency: 100000000 },
    marketData: DEFAULT_MARKET_DATA,
    initialTicker: DEFAULT_TICKER,
  };

  const exchange = new DummyCentralizedExchange(exchangeConfig as DummyCentralizedExchangeConfig);
  const numberOfOrders = 10000;

  // Setup orders that won't be filled
  // Current price ~100 (default)
  // Create BUY orders at 50
  // Create SELL orders at 150
  for (let i = 0; i < numberOfOrders / 2; i++) {
    await exchange.createLimitOrder('BUY', 1, 50);
  }
  for (let i = 0; i < numberOfOrders / 2; i++) {
    await exchange.createLimitOrder('SELL', 1, 150);
  }

  bench('processOneMinuteCandle with 10k orders (no fills)', async () => {
    const candle: Candle = {
      start: Date.now(),
      open: 100,
      high: 105,
      low: 95,
      close: 100,
      volume: 1000,
    };
    await exchange.processOneMinuteCandle(candle);
  });
});
