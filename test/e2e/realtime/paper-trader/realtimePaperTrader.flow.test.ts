import type { SQLiteStorage } from '@services/storage/sqlite.storage';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as originalDateFns from 'date-fns';
import { cleanDatabase } from '../../helpers/database.helper';
import { MockCCXTExchange } from '../../mocks/ccxt.mock';
import { mockDateFns } from '../../mocks/date-fns.mock';
import { MockFetcherService } from '../../mocks/fetcher.mock';
import { MockHeart } from '../../mocks/heart.mock';
import { MockWinston, clearLogs, logStore } from '../../mocks/winston.mock';

// --------------------------------------------------------------------------
// MOCKS SETUP
// --------------------------------------------------------------------------
const DEFAULT_MOCK_STRATEGY_CONFIG = { name: 'DebugAdvice', waittime: 0, each: 4 };
const DEFAULT_MOCK_STRATEGY_NAME = 'DebugAdvice';

const FAST_MINUTE = 50;
const TARGET_CANDLES = 20; // Track candles emitted

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
let mockStrategyConfig: any = DEFAULT_MOCK_STRATEGY_CONFIG;
let mockStrategyName = DEFAULT_MOCK_STRATEGY_NAME;
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
        exchangeSynchInterval: 10 * 60 * 1000,
      }),
      getStorage: () => ({
        type: 'sqlite',
        path: ':memory:', // Isolated DB
      }),
      getPlugins: () => [
        { name: 'TradingAdvisor', strategyName: mockStrategyName },
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
    clearLogs();

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
    MockCCXTExchange.emitDuplicatesEveryXCandle = 0;
    MockCCXTExchange.emitFutureCandles = false;
    MockCCXTExchange.mockTrades = [];
    MockCCXTExchange.shouldThrowOnCreateOrder = false;
    MockCCXTExchange.simulateOpenOrders = false;

    // Reset config defaults
    mockStrategyConfig = DEFAULT_MOCK_STRATEGY_CONFIG;
    mockStrategyName = DEFAULT_MOCK_STRATEGY_NAME;
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

  it('Scenario B: Precision PnL & Fee Verification', async () => {
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const { RoundTripAnalyzer } = await import('@plugins/analyzers/roundTripAnalyzer/roundTripAnalyzer');
    const { ROUNDTRIP_COMPLETED_EVENT } = await import('@constants/event.const');

    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    // Spy on RoundTripAnalyzer.emit to capture the internal event
    let roundtripData: any = null;
    const originalEmit = RoundTripAnalyzer.prototype.emit;
    const spy = mock(function (this: any, event: string, data: any) {
      if (event === ROUNDTRIP_COMPLETED_EVENT) {
        roundtripData = data;
      }
      return originalEmit.call(this, event, data);
    });
    RoundTripAnalyzer.prototype.emit = spy;

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

    // Restore original emit
    RoundTripAnalyzer.prototype.emit = originalEmit;

    expect(roundtripData).toBeDefined();

    const roundtrip = Array.isArray(roundtripData) ? roundtripData[0] : roundtripData;
    const { entryPrice, exitPrice, entryEquity, exitEquity, pnl, profit } = roundtrip;

    expect(entryPrice).toBeGreaterThan(0);
    expect(exitPrice).toBeGreaterThan(0);

    // PnL = Exit Equity - Entry Equity
    // Floating point precision check
    expect(pnl).toBeCloseTo(exitEquity - entryEquity, 8);

    // Profit % = ((Exit Equity / Entry Equity) - 1) * 100
    const expectedProfit = (exitEquity / entryEquity - 1) * 100;
    expect(profit).toBeCloseTo(expectedProfit, 8);

    // Check structure
    expect(roundtrip).toHaveProperty('id');
    expect(roundtrip).toHaveProperty('entryAt');
    expect(roundtrip).toHaveProperty('exitAt');
    expect(roundtrip).toHaveProperty('duration');
  });

  it('Scenario C: Trailing Stop Lifecycle', async () => {
    // Override strategy to use DebugTrailingStop with trailing stop config
    mockStrategyName = 'DebugTrailingStop';
    mockStrategyConfig = { name: 'DebugTrailingStop', wait: 0, trigger: 9930, percentage: 0.1 };

    MockCCXTExchange.setPredefinedCandles('BTC/USDT', [
      { close: 9500 }, // Places BUY order
      { close: 9500 }, // TS dormant
      { close: 10000, high: 10000, low: 9995 }, // TS active, stopPrice == 9990
      { close: 9800, high: 9995, low: 9800 }, // TS triggers SELL
      { close: 9800 }, // SELL completes
      { close: 9800 },
    ]);

    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');
    const storage = inject.storage() as SQLiteStorage;
    storage.close = () => {};

    const pipelinePromise = gekkoPipeline();
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS))]);

    // Verify trailing stop BUY order was created by the strategy
    const createdLog = logStore.find(log => typeof log.message === 'string' && log.message.includes('Trailing stop BUY order created'));
    expect(createdLog).toBeDefined();

    // Verify the orders were completed (BUY order completed and then SELL order completed after trigger)
    const completedLogs = logStore.filter(log => typeof log.message === 'string' && log.message.includes('Trailing stop order completed'));
    expect(completedLogs.length).toBeGreaterThanOrEqual(2);
  });
});
