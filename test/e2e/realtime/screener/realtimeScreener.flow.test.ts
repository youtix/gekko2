import type { SQLiteStorage } from '@services/storage/sqlite.storage';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as originalDateFns from 'date-fns';
import { MockCCXTExchange } from '../../mocks/ccxt.mock';
import { mockDateFns } from '../../mocks/date-fns.mock';
import { MockFetcherService } from '../../mocks/fetcher.mock';
import { MockHeart } from '../../mocks/heart.mock';
import { MockWinston, clearLogs } from '../../mocks/winston.mock';

// --------------------------------------------------------------------------
// MOCKS SETUP
// --------------------------------------------------------------------------

const DEFAULT_MOCK_STRATEGY_CONFIG = { name: 'DebugAdvice', waittime: 0, each: 2 };

// For realtime mode we use accelerated time (10ms = 1 minute)
const FAST_MINUTE = 50;

// Track candles emitted
const TARGET_CANDLES = 10;

// Wait for candles to be collected (with accelerated time, this should be fast)
// We'll wait for TARGET_CANDLES * FAST_MINUTE to give buffer
const TIMEOUT_MS = TARGET_CANDLES * FAST_MINUTE;

const TELEGRAM_TOKEN = 'test-token';
const TELEGRAM_USERNAME = 'test-bot';

// 1. Mock Winston
mock.module('winston', () => MockWinston);

// 2. Mock Time Constants
mock.module('@constants/time.const', () => ({
  ONE_SECOND: 1,
  ONE_MINUTE: FAST_MINUTE,
}));

// 3. Mock Fetcher

// Define the subscription response
const subscriptionResponse = {
  ok: true,
  result: [
    {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 123, is_bot: false, first_name: 'Test', username: 'test' },
        chat: { id: 123, first_name: 'Test', username: 'test', type: 'private' },
        date: 1600000000,
        text: '/subscribe_all@test-bot',
      },
    },
  ],
};

mock.module('@services/fetcher/fetcher.service', () => ({
  fetcher: new MockFetcherService(),
}));

// 4. Mock Configuration
let mockPairs = [
  { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' },
  { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT' },
];
let mockStrategyConfig = DEFAULT_MOCK_STRATEGY_CONFIG;
mock.module('@services/configuration/configuration', () => {
  return {
    config: {
      getWatch: () => ({
        mode: 'realtime',
        pairs: mockPairs,
        timeframe: '1m',
        tickrate: 100,
        warmup: { candleCount: 0, tickrate: 100 },
      }),
      showLogo: () => false,
      getExchange: () => ({
        name: 'paper-binance',
        verbose: false,
        simulationBalance: new Map([
          ['BTC', 100],
          ['ETH', 100],
          ['USDT', 300000],
        ]),
      }),
      getStorage: () => ({
        type: 'sqlite',
        path: ':memory:', // Isolated DB
      }),
      getPlugins: () => [
        { name: 'TradingAdvisor', strategyName: 'DebugAdvice' },
        { name: 'Trader' },
        { name: 'EventSubscriber', token: TELEGRAM_TOKEN, botUsername: TELEGRAM_USERNAME },
      ],
      getStrategy: () => mockStrategyConfig,
    },
  };
});

// 5. Mock CCXT Library
class MockNetworkError extends Error {}
mock.module('ccxt', () => {
  return {
    default: {
      binance: MockCCXTExchange,
      NetworkError: MockNetworkError,
    },
    binance: MockCCXTExchange,
    NetworkError: MockNetworkError,
  };
});

// 6. Mock date-fns
mock.module('date-fns', () => {
  return {
    ...originalDateFns,
    ...mockDateFns,
  };
});

// 7. Mock Heart
mock.module('@services/core/heart/heart', () => ({
  Heart: MockHeart,
}));

import { cleanDatabase } from '../../helpers/database.helper';

describe('E2E: Realtime Screener Flow', () => {
  beforeEach(async () => {
    // Stop all stale hearts from previous tests to prevent timer leakage
    MockHeart.stopAll();

    // Reset inject singletons
    const { inject } = await import('@services/injecter/injecter');
    inject.reset();

    // Clean DB
    const storage = inject.storage() as SQLiteStorage;
    cleanDatabase(storage);
    clearLogs();

    // Reset mocks
    MockFetcherService.reset();

    // Configure Telegram subscription response (only once)
    let getCallCount = 0;
    MockFetcherService.when('getUpdates').thenReturn(() => {
      getCallCount++;
      if (getCallCount === 1) {
        return subscriptionResponse;
      }
      return { ok: true, result: [] };
    });

    // Reset MockCCXTExchange static state
    MockCCXTExchange.simulatedGaps = [];
    MockCCXTExchange.shouldThrowError = false;
    MockCCXTExchange.emitDuplicatesEveryXCandle = 0;
    MockCCXTExchange.emitFutureCandles = false;
    MockCCXTExchange.mockTrades = [];
    MockCCXTExchange.shouldThrowOnCreateOrder = false;
    MockCCXTExchange.simulateOpenOrders = false;

    // Reset config defaults
    mockStrategyConfig = DEFAULT_MOCK_STRATEGY_CONFIG;
    mockPairs = [
      { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' },
      { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT' },
    ];
  });

  it('Scenario A: Standard Screener Flow (Buy/Sell Alert)', async () => {
    // Dynamic imports
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');

    // Get storage reference
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    // Run pipeline
    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

    // Verify Telegram messages were sent
    // We expect at least one message for order placement (DebugAdvice triggers every candle with each=1)
    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);

    expect(calls.filter(call => call.payload.text.includes('BUY')).length).toBeGreaterThanOrEqual(1);
    expect(calls.filter(call => call.payload.text.includes('SELL')).length).toBeGreaterThanOrEqual(1);
  });

  it('Scenario B: Multi-Pair Signal Independence', async () => {
    // Both BTC and ETH are in default mockPairs
    // Strategy triggers every candle (each: 1)

    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    // Check we have messages for BOTH pairs
    // We expect at least one message for each pair
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter(call => call.payload.text.includes('BTC/USDT')).length).toBeGreaterThan(0);
    expect(calls.filter(call => call.payload.text.includes('ETH/USDT')).length).toBeGreaterThan(0);
  });

  it('Scenario C: Strategy Creation order process', async () => {
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');

    expect(calls.filter(call => call.payload.text.includes('advice')).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter(call => call.payload.text.includes('order created')).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter(call => call.payload.text.includes('order completed')).length).toBeGreaterThanOrEqual(2);
  });

  it('Scenario D: Strategy Info Event Subscription (Logs)', async () => {
    // Strategy triggers logs every candle
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);

    // Look for strategy info messages
    // EventSubscriber formats it as: "• 2026-02-07T17:24:27.000Z [DEBUG] (strategy)\nIteration: 0 for BTC/USDT\n------\n"
    expect(calls.filter(call => call.payload.text.includes('[DEBUG] (strategy)')).length).toBeGreaterThan(5);

    // Verify content of at least one message
    const sampleMessage = calls
      .filter(call => call.payload.text.includes('[DEBUG] (strategy)'))
      .find(call => call.payload.text.includes('Iteration:'));
    expect(sampleMessage?.payload.text).toContain('BTC/USDT');
  });

  it('Scenario E: Order Cancellation', async () => {
    // Enable open orders so they don't auto-fill
    MockCCXTExchange.simulateOpenOrders = true;

    // Configure strategy to cancel orders after 1 candle
    mockStrategyConfig = {
      ...DEFAULT_MOCK_STRATEGY_CONFIG,
      // @ts-expect-error - dynamic property added to debug advice
      cancelAfter: 1,
    };

    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);

    // Check for Strategy Cancel Order notification
    expect(calls.filter(call => call.payload.text.includes('Strategy requested order cancellation')).length).toBeGreaterThan(0);
    expect(calls.filter(call => call.payload.text.includes('order canceled')).length).toBeGreaterThan(0);

    MockCCXTExchange.simulateOpenOrders = false;
  });

  it('Scenario F: Order Error Handling', async () => {
    // Monkey-patch DummyCentralizedExchange to throw error
    const { DummyCentralizedExchange } = await import('@services/exchange/dummy/dummyCentralizedExchange');
    const originalCreateLimitOrder = DummyCentralizedExchange.prototype.createLimitOrder;
    DummyCentralizedExchange.prototype.createLimitOrder = async function () {
      throw new Error('Simulated Exchange Error');
    };

    try {
      const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
      const { inject } = await import('@services/injecter/injecter');
      const storage = inject.storage() as SQLiteStorage;
      storage.close = () => {};

      const pipelinePromise = gekkoPipeline();
      await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

      const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
      expect(calls.length).toBeGreaterThan(0);

      // DebugAdvice logs "Order Errored: <id>" when onOrderErrored is called.
      // EventSubscriber picks this up as a strategy log.
      expect(calls.filter(call => call.payload.text.includes('Order Errored')).length).toBeGreaterThan(0);
    } finally {
      // Restore original method
      DummyCentralizedExchange.prototype.createLimitOrder = originalCreateLimitOrder;
    }
  });
});
