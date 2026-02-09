import type { SQLiteStorage } from '@services/storage/sqlite.storage';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as originalDateFns from 'date-fns';
import { MockCCXTExchange } from '../../mocks/ccxt.mock';
import { mockDateFns } from '../../mocks/date-fns.mock';
import { MockHeart } from '../../mocks/heart.mock';

// --------------------------------------------------------------------------
// MOCKS SETUP
// --------------------------------------------------------------------------

// 1. Mock Configuration
let mockPairs = [
  { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' },
  { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT' },
];

let mockStrategyConfig = {
  name: 'DebugAdvice',
  waittime: 0,
  each: 1,
};

const FAST_MINUTE = 20;
const TELEGRAM_TOKEN = 'test-token';
const TELEGRAM_USERNAME = 'test-bot';

// 2. Mock Time Constants
mock.module('@constants/time.const', () => ({
  ONE_SECOND: 1,
  ONE_MINUTE: FAST_MINUTE,
}));

// 3. Mock Fetcher
import { MockFetcherService } from '../../mocks/fetcher.mock';

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

// --------------------------------------------------------------------------
// TEST SUITE
// --------------------------------------------------------------------------

describe('E2E: Realtime Screener Flow', () => {
  beforeEach(async () => {
    // Reset inject singletons
    const { inject } = await import('@services/injecter/injecter');
    inject.reset();

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

    MockCCXTExchange.simulatedGaps = [];
    MockCCXTExchange.shouldThrowError = false;
    MockCCXTExchange.emitDuplicates = false;
    MockCCXTExchange.emitFutureCandles = false;
    MockCCXTExchange.emitWithGaps = false;
    MockCCXTExchange.pollingInterval = FAST_MINUTE;
    MockCCXTExchange.mockTrades = [];
    MockCCXTExchange.shouldThrowOnCreateOrder = false;
    MockCCXTExchange.simulateOpenOrders = false;

    // Reset config defaults
    mockStrategyConfig = {
      name: 'DebugAdvice',
      waittime: 0,
      each: 1,
    };
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

    // Track candles emitted
    const TARGET_CANDLES = 2;
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 2 + 50;

    // Run pipeline
    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    // Verify Telegram messages were sent
    // We expect at least one message for order placement (DebugAdvice triggers every candle with each=1)
    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);

    // Look for a message containing "order created" or similar from EventSubscriber
    // The fetcher mock receives { url, payload }
    const orderMessages = calls.filter(call => {
      const payload = call.payload;

      return payload && payload.text && (payload.text.includes('order created') || payload.text.includes('order completed'));
    });

    expect(orderMessages.length).toBeGreaterThan(0);
    expect(orderMessages.length).toBeGreaterThan(0);
    const lastCall = orderMessages.reverse().find(call => call.payload.text.includes('BTC/USDT'));
    if (!lastCall || !lastCall.payload) {
      throw new Error('Unexpected empty call or payload');
    }
    const lastMessage = lastCall.payload.text;

    expect(lastMessage).toContain('BTC/USDT');
    // Check for some order detail
    expect(lastMessage).toMatch(/(Buy|Sell)/i);
  });

  it('Scenario B: Multi-Pair Signal Independence', async () => {
    // Both BTC and ETH are in default mockPairs
    // Strategy triggers every candle (each: 1)

    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    // Increase target candles and timeout slightly to ensure both streams start
    const TARGET_CANDLES = 3;
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 2 + 50;

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);
    const orderMessages = calls.filter(call => {
      const payload = call.payload;
      return payload && payload.text && (payload.text.includes('order created') || payload.text.includes('order completed'));
    });

    // Check we have messages for BOTH pairs
    const btcMessages = orderMessages.filter(call => call.payload.text.includes('BTC/USDT'));
    const ethMessages = orderMessages.filter(call => call.payload.text.includes('ETH/USDT'));

    // We expect at least one message for each pair
    expect(btcMessages.length).toBeGreaterThan(0);
    expect(ethMessages.length).toBeGreaterThan(0);
  });

  it('Scenario C: Strategy Creation order process', async () => {
    mockStrategyConfig = { name: 'DebugAdvice', waittime: 0, each: 4 };

    // Verify we updated config

    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    const TARGET_CANDLES = 10;
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 2 + 30;

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

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

    const TARGET_CANDLES = 2;
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 2 + 50;

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);

    // Look for strategy info messages
    // EventSubscriber formats it as: "• 2026-02-07T17:24:27.000Z [DEBUG] (strategy)\nIteration: 0 for BTC/USDT\n------\n"
    const infoMessages = calls.filter(call => {
      const payload = call.payload;
      return payload && payload.text && payload.text.includes('[DEBUG] (strategy)') && payload.text.includes('Iteration:');
    });

    expect(infoMessages.length).toBeGreaterThan(0);

    // Verify content of at least one message
    const sampleMessage = infoMessages[0].payload.text;
    expect(sampleMessage).toContain('Iteration:');
    expect(sampleMessage).toContain('BTC/USDT');
  });

  it('Scenario E: Order Cancellation', async () => {
    // Enable open orders so they don't auto-fill
    MockCCXTExchange.simulateOpenOrders = true;

    // Configure strategy to cancel orders after 1 candle
    mockStrategyConfig = {
      name: 'DebugAdvice',
      waittime: 0,
      each: 2, // Less frequent creation to pinpoint cancellation
      // @ts-expect-error - dynamic property added to debug advice
      cancelAfter: 1,
    };

    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    const TARGET_CANDLES = 4;
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 2 + 50;

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);

    // Check for Strategy Cancel Order notification
    const stratCancelMessages = calls.filter(call => {
      const payload = call.payload;
      return payload && payload.text && payload.text.includes('Strategy requested order cancellation');
    });

    // Check for Order Canceled notification (Exchange confirmation)
    const orderCancelMessages = calls.filter(call => {
      const payload = call.payload;
      return payload && payload.text && payload.text.includes('order canceled') && !payload.text.includes('requested');
    });

    expect(stratCancelMessages.length).toBeGreaterThan(0);
    expect(orderCancelMessages.length).toBeGreaterThan(0);
  });

  it('Scenario F: Order Error Handling', async () => {
    // Monkey-patch DummyCentralizedExchange to throw error
    const { DummyCentralizedExchange } = await import('@services/exchange/dummy/dummyCentralizedExchange');
    const originalCreateLimitOrder = DummyCentralizedExchange.prototype.createLimitOrder;
    DummyCentralizedExchange.prototype.createLimitOrder = async function () {
      throw new Error('Simulated Exchange Error');
    };

    try {
      // Strategy triggers every candle
      mockStrategyConfig = {
        name: 'DebugAdvice',
        waittime: 0,
        each: 1,
      };

      const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
      const { inject } = await import('@services/injecter/injecter');
      const storage = inject.storage() as SQLiteStorage;
      storage.close = () => {};

      const TARGET_CANDLES = 2;
      const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 2 + 50;

      const pipelinePromise = gekkoPipeline();
      await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

      const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
      expect(calls.length).toBeGreaterThan(0);

      // DebugAdvice logs "Order Errored: <id>" when onOrderErrored is called.
      // EventSubscriber picks this up as a strategy log.
      const errorMessages = calls.filter(call => {
        const payload = call.payload;
        return payload && payload.text && payload.text.includes('Order Errored');
      });

      expect(errorMessages.length).toBeGreaterThan(0);
    } finally {
      // Restore original method
      DummyCentralizedExchange.prototype.createLimitOrder = originalCreateLimitOrder;
    }
  });
});
