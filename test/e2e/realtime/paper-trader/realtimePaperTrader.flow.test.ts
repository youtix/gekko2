import type { SQLiteStorage } from '@services/storage/sqlite.storage';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as originalDateFns from 'date-fns';
import { cleanDatabase } from '../../helpers/database.helper';
import { MockCCXTExchange } from '../../mocks/ccxt.mock';
import { mockDateFns } from '../../mocks/date-fns.mock';
import { MockFetcherService } from '../../mocks/fetcher.mock';
import { MockHeart } from '../../mocks/heart.mock';
import { MockWinston } from '../../mocks/winston.mock';

// --------------------------------------------------------------------------
// MOCKS SETUP
// --------------------------------------------------------------------------
const DEFAULT_MOCK_STRATEGY_CONFIG = { name: 'DebugAdvice', waittime: 0, each: 4 };

const FAST_MINUTE = 50;
const TARGET_CANDLES = 10; // Track candles emitted

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
let mockPairs = [{ symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' }];
let mockStrategyConfig = DEFAULT_MOCK_STRATEGY_CONFIG;
mock.module('@services/configuration/configuration', () => {
  return {
    config: {
      getWatch: () => ({
        mode: 'realtime',
        pairs: mockPairs,
        timeframe: '1m',
        tickrate: 100,
        warmup: { candleCount: 0 },
        assets: ['BTC'],
        currency: 'USDT',
      }),
      showLogo: () => false,
      getExchange: () => ({
        name: 'paper-binance',
        verbose: false,
        simulationBalance: new Map([
          ['BTC', 100],
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
        { name: 'RoundTripAnalyzer', enableConsoleTable: false },
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

describe('E2E: Realtime Paper Trader Flow', () => {
  beforeEach(async () => {
    // Reset inject singletons
    const { inject } = await import('@services/injecter/injecter');
    inject.reset();

    // Clean DB
    const storage = inject.storage() as SQLiteStorage;
    cleanDatabase(storage);

    // Reset mocks
    MockFetcherService.reset();

    // Configure Telegram subscription response (only once)
    let getCallCount = 0;
    MockFetcherService.when('getUpdates').thenReturn(() => {
      if (++getCallCount === 1) return subscriptionResponse;
      return { ok: true, result: [] };
    });

    // Reset MockCCXTExchange static state
    MockCCXTExchange.simulatedGaps = [];
    MockCCXTExchange.shouldThrowError = false;
    MockCCXTExchange.emitDuplicates = false;
    MockCCXTExchange.emitFutureCandles = false;
    MockCCXTExchange.mockTrades = [];
    MockCCXTExchange.shouldThrowOnCreateOrder = false;
    MockCCXTExchange.simulateOpenOrders = false;

    // Reset config defaults
    mockStrategyConfig = DEFAULT_MOCK_STRATEGY_CONFIG;
    mockPairs = [{ symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' }];
  });

  it('Scenario A: Roundtrip Completion Notification', async () => {
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

    const calls = MockFetcherService.callHistory.filter(c => c.method === 'POST');
    expect(calls.length).toBeGreaterThan(0);

    // Filter for Roundtrip Completed messages
    const roundtripMessages = calls.find(call => call.payload.text.includes('Roundtrip completed'));
    expect(roundtripMessages).toBeDefined();
    expect(roundtripMessages?.payload.text).toContain('PnL:');
    expect(roundtripMessages?.payload.text).toContain('Profit:');
    expect(roundtripMessages?.payload.text).toContain('Entry Price:');
    expect(roundtripMessages?.payload.text).toContain('Exit Price:');
  });
});
