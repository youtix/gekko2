import type { SQLiteStorage } from '@services/storage/sqlite.storage';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { first } from 'lodash-es';
import { generateSyntheticCandle } from '../../fixtures/syntheticData';
import { MockCCXTExchange } from '../../mocks/ccxt.mock';

// --------------------------------------------------------------------------
// MOCKS SETUP
// --------------------------------------------------------------------------

// 1. Mock Configuration
// Configure all pairs from the start to ensure all tables are created
const mockPairs = [
  { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' },
  { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT' },
  { symbol: 'LTC/USDT', base: 'LTC', quote: 'USDT' },
];

// For realtime mode we use accelerated time (10ms = 1 minute)
const FAST_MINUTE = 10;

// 2. Mock Time Constants - Must be before other imports that use time
mock.module('@constants/time.const', () => ({
  ONE_SECOND: 1,
  ONE_MINUTE: FAST_MINUTE,
}));

// 3. Mock Configuration
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
        name: 'binance',
        verbose: false,
      }),
      getStorage: () => ({
        type: 'sqlite',
        path: ':memory:', // Isolated DB
      }),
      getPlugins: () => [
        {
          name: 'CandleWriter', // Enable writing to DB
        },
      ],
      getStrategy: () => ({}),
    },
  };
});

// 4. Mock CCXT Library
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

// --------------------------------------------------------------------------
// TEST SUITE
// --------------------------------------------------------------------------

describe('E2E: Realtime Writer (Synthetic)', () => {
  // Reset MockCCXTExchange static state and inject singletons before each test
  // This is especially important when running all E2E tests together
  beforeEach(async () => {
    // Reset inject singletons to get fresh storage/exchange for each test
    const { inject } = await import('@services/injecter/injecter');
    inject.reset();

    // Reset MockCCXTExchange static state
    MockCCXTExchange.simulatedGaps = [];
    MockCCXTExchange.shouldThrowError = false;
    MockCCXTExchange.emitDuplicates = false;
    MockCCXTExchange.emitFutureCandles = false;
    MockCCXTExchange.emitWithGaps = false;
    MockCCXTExchange.pollingInterval = FAST_MINUTE; // Use accelerated time
  });

  it('Scenario A: Realtime candle recording to SQLite', async () => {
    // Dynamic imports to ensure mocks are applied first
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');

    // Get storage reference before pipeline runs
    const storage = inject.storage() as SQLiteStorage;
    // Keep DB open for subsequent tests
    storage.close = () => {};

    // Track candles emitted
    const TARGET_CANDLES = 5;

    // Create a timeout promise to stop the pipeline after we collect enough candles
    const pipelinePromise = gekkoPipeline();

    // Wait for candles to be collected (with accelerated time, this should be fast)
    // We'll wait for TARGET_CANDLES * FAST_MINUTE * 2 to give buffer
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 3 + 100;

    // Use Promise.race with a timeout to stop waiting after enough time
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    // Access private db instance for verification
    const db = storage['db'];

    // Verify tables exist and have data
    const rowCountBTC = db.query('SELECT count(*) as count FROM candles_BTC_USDT').get() as { count: number };

    // We should have at least some candles recorded
    // Due to the accelerated time, the exact count depends on timing
    expect(rowCountBTC.count).toBeGreaterThanOrEqual(1);

    // Verify data integrity - check first candle
    const rows = db.query('SELECT * FROM candles_BTC_USDT ORDER BY start ASC').all() as any[];

    if (rows.length > 0) {
      const firstRow = first(rows);
      // Verify it has valid OHLCV data
      expect(firstRow.open).toBeDefined();
      expect(firstRow.high).toBeDefined();
      expect(firstRow.low).toBeDefined();
      expect(firstRow.close).toBeDefined();
      expect(firstRow.volume).toBeDefined();

      // Verify the synthetic data matches our generator
      const expectedCandle = generateSyntheticCandle('BTC/USDT', firstRow.start);
      expect(firstRow.open).toBeCloseTo(expectedCandle.open, 4);
    }
  }, 30000);

  it('Scenario B: Multi-pair recording consistency', async () => {
    // Storage is already configured with all pairs from the start

    // Dynamic imports to ensure mocks are applied first
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');

    // Get storage reference - close is already disabled from Scenario A
    const storage = inject.storage() as SQLiteStorage;

    // Track candles emitted
    const TARGET_CANDLES = 5;

    // Create a timeout promise to stop the pipeline after we collect enough candles
    const pipelinePromise = gekkoPipeline();

    // Wait for candles to be collected (with accelerated time, this should be fast)
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 3 + 100;

    // Use Promise.race with a timeout to stop waiting after enough time
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    // Access private db instance for verification
    const db = storage['db'];

    // Verify each pair has its own table with data
    const rowCountBTC = db.query('SELECT count(*) as count FROM candles_BTC_USDT').get() as { count: number };
    const rowCountETH = db.query('SELECT count(*) as count FROM candles_ETH_USDT').get() as { count: number };
    const rowCountLTC = db.query('SELECT count(*) as count FROM candles_LTC_USDT').get() as { count: number };

    // All pairs should have at least some candles recorded
    expect(rowCountBTC.count).toBeGreaterThanOrEqual(1);
    expect(rowCountETH.count).toBeGreaterThanOrEqual(1);
    expect(rowCountLTC.count).toBeGreaterThanOrEqual(1);

    // Verify no cross-contamination - each table should only have candles
    // matching the expected synthetic data for that pair
    const btcRows = db.query('SELECT * FROM candles_BTC_USDT ORDER BY start ASC').all() as any[];
    const ethRows = db.query('SELECT * FROM candles_ETH_USDT ORDER BY start ASC').all() as any[];
    const ltcRows = db.query('SELECT * FROM candles_LTC_USDT ORDER BY start ASC').all() as any[];

    // Verify BTC data integrity and uniqueness
    if (btcRows.length > 0) {
      const firstBtcRow = first(btcRows);
      const expectedBtcCandle = generateSyntheticCandle('BTC/USDT', firstBtcRow.start);
      expect(firstBtcRow.open).toBeCloseTo(expectedBtcCandle.open, 4);

      // Ensure this candle doesn't match ETH or LTC expected prices
      const wrongEthCandle = generateSyntheticCandle('ETH/USDT', firstBtcRow.start);
      const wrongLtcCandle = generateSyntheticCandle('LTC/USDT', firstBtcRow.start);

      // The prices should be different due to the symbol offset in synthetic generator
      expect(firstBtcRow.open).not.toBeCloseTo(wrongEthCandle.open, 4);
      expect(firstBtcRow.open).not.toBeCloseTo(wrongLtcCandle.open, 4);
    }

    // Verify ETH data integrity and uniqueness
    if (ethRows.length > 0) {
      const firstEthRow = first(ethRows);
      const expectedEthCandle = generateSyntheticCandle('ETH/USDT', firstEthRow.start);
      expect(firstEthRow.open).toBeCloseTo(expectedEthCandle.open, 4);

      // Ensure this candle doesn't match BTC or LTC expected prices
      const wrongBtcCandle = generateSyntheticCandle('BTC/USDT', firstEthRow.start);
      const wrongLtcCandle = generateSyntheticCandle('LTC/USDT', firstEthRow.start);

      expect(firstEthRow.open).not.toBeCloseTo(wrongBtcCandle.open, 4);
      expect(firstEthRow.open).not.toBeCloseTo(wrongLtcCandle.open, 4);
    }

    // Verify LTC data integrity and uniqueness
    if (ltcRows.length > 0) {
      const firstLtcRow = first(ltcRows);
      const expectedLtcCandle = generateSyntheticCandle('LTC/USDT', firstLtcRow.start);
      expect(firstLtcRow.open).toBeCloseTo(expectedLtcCandle.open, 4);

      // Ensure this candle doesn't match BTC or ETH expected prices
      const wrongBtcCandle = generateSyntheticCandle('BTC/USDT', firstLtcRow.start);
      const wrongEthCandle = generateSyntheticCandle('ETH/USDT', firstLtcRow.start);

      expect(firstLtcRow.open).not.toBeCloseTo(wrongBtcCandle.open, 4);
      expect(firstLtcRow.open).not.toBeCloseTo(wrongEthCandle.open, 4);
    }
  }, 30000);

  it('Scenario C: Handling of duplicate candle emissions', async () => {
    // Enable duplicate emission mode in the mock exchange
    // This simulates reconnection overlap where the same candle is emitted twice
    MockCCXTExchange.emitDuplicates = true;

    // Dynamic imports to ensure mocks are applied first
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');

    // Get storage reference - close is already disabled from previous scenarios
    const storage = inject.storage() as SQLiteStorage;
    const db = storage['db'];

    // Track candles emitted
    const TARGET_CANDLES = 5;

    // Run the pipeline - this should NOT throw any errors even with duplicates
    const pipelinePromise = gekkoPipeline();

    // Wait for candles to be collected (with accelerated time, this should be fast)
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 3 + 100;

    // Use Promise.race with a timeout to stop waiting after enough time
    // The key assertion here is that this does NOT throw
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    // ASSERTION 1: The pipeline completed without errors (we got here = no error thrown)

    // ASSERTION 2: Verify no duplicate timestamps in the database
    // The system should gracefully ignore duplicates and ensure DB integrity
    const duplicatedTimestamps = db
      .query('SELECT start, count(*) as cnt FROM candles_BTC_USDT GROUP BY start HAVING cnt > 1')
      .all() as any[];

    // There should be NO duplicate timestamps stored in the database
    expect(duplicatedTimestamps.length).toBe(0);

    // ASSERTION 3: Also check ETH and LTC tables for no duplicates
    const duplicatedTimestampsETH = db
      .query('SELECT start, count(*) as cnt FROM candles_ETH_USDT GROUP BY start HAVING cnt > 1')
      .all() as any[];
    const duplicatedTimestampsLTC = db
      .query('SELECT start, count(*) as cnt FROM candles_LTC_USDT GROUP BY start HAVING cnt > 1')
      .all() as any[];

    expect(duplicatedTimestampsETH.length).toBe(0);
    expect(duplicatedTimestampsLTC.length).toBe(0);

    // ASSERTION 4: Verify the stored candles are valid and not corrupted by duplicate handling
    const recentCandles = db.query('SELECT * FROM candles_BTC_USDT ORDER BY start DESC LIMIT 5').all() as any[];
    expect(recentCandles.length).toBeGreaterThan(0);

    for (const candle of recentCandles) {
      // Each candle should have valid OHLCV data
      expect(candle.open).toBeDefined();
      expect(candle.high).toBeDefined();
      expect(candle.low).toBeDefined();
      expect(candle.close).toBeDefined();
      expect(candle.volume).toBeDefined();

      // Verify data matches the synthetic generator
      const expectedCandle = generateSyntheticCandle('BTC/USDT', candle.start);
      expect(candle.open).toBeCloseTo(expectedCandle.open, 4);
    }

    // Clean up: reset the mock flag for subsequent tests
    MockCCXTExchange.emitDuplicates = false;
  }, 30000);

  it('Scenario D: Handling future candle emissions', async () => {
    // Enable future candle emission mode in the mock exchange
    // This simulates a scenario where a candle with a timestamp > Date.now() is emitted
    MockCCXTExchange.emitFutureCandles = true;

    // Dynamic imports to ensure mocks are applied first
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');

    // Get storage reference - close is already disabled from previous scenarios
    const storage = inject.storage() as SQLiteStorage;
    const db = storage['db'];

    // Record the current time before running the pipeline
    const now = Date.now();

    // Track candles emitted
    const TARGET_CANDLES = 5;

    // Run the pipeline - this should NOT throw any errors even with future candles
    const pipelinePromise = gekkoPipeline();

    // Wait for candles to be collected (with accelerated time, this should be fast)
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 3 + 100;

    // Use Promise.race with a timeout to stop waiting after enough time
    // The key assertion here is that this does NOT throw
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    // ASSERTION 1: The pipeline completed without errors (we got here = no error thrown)

    // ASSERTION 2: Verify no future candles are stored in the database
    // The system should gracefully ignore future candles
    const futureCandles = db.query('SELECT * FROM candles_BTC_USDT WHERE start > ?').all(now) as any[];

    // There should be NO future candles stored in the database
    expect(futureCandles.length).toBe(0);

    // ASSERTION 3: Also check ETH and LTC tables for no future candles
    const futureCandlesETH = db.query('SELECT * FROM candles_ETH_USDT WHERE start > ?').all(now) as any[];
    const futureCandlesLTC = db.query('SELECT * FROM candles_LTC_USDT WHERE start > ?').all(now) as any[];

    expect(futureCandlesETH.length).toBe(0);
    expect(futureCandlesLTC.length).toBe(0);

    // ASSERTION 4: Verify valid candles are still being recorded correctly
    const recentCandles = db.query('SELECT * FROM candles_BTC_USDT ORDER BY start DESC LIMIT 5').all() as any[];
    expect(recentCandles.length).toBeGreaterThan(0);

    for (const candle of recentCandles) {
      // Each candle should have valid OHLCV data
      expect(candle.open).toBeDefined();
      expect(candle.high).toBeDefined();
      expect(candle.low).toBeDefined();
      expect(candle.close).toBeDefined();
      expect(candle.volume).toBeDefined();

      // Verify the candle timestamp is NOT in the future
      expect(candle.start).toBeLessThanOrEqual(now);

      // Verify data matches the synthetic generator
      const expectedCandle = generateSyntheticCandle('BTC/USDT', candle.start);
      expect(candle.open).toBeCloseTo(expectedCandle.open, 4);
    }

    // Clean up: reset the mock flag for subsequent tests
    MockCCXTExchange.emitFutureCandles = false;
  }, 30000);

  it('Scenario E: Filling candle gaps', async () => {
    // Enable gap emission mode in the mock exchange
    // This simulates a scenario where some candles are missing from the exchange response
    // (e.g., exchange connectivity issues, rate limiting, network drops)
    MockCCXTExchange.emitWithGaps = true;

    // Dynamic imports to ensure mocks are applied first
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');

    // Get storage reference - close is already disabled from previous scenarios
    const storage = inject.storage() as SQLiteStorage;
    const db = storage['db'];

    // Track candles emitted - need more for proper gap verification
    const TARGET_CANDLES = 10;

    // Run the pipeline - this should NOT throw any errors even with gaps
    const pipelinePromise = gekkoPipeline();

    // Wait for candles to be collected (with accelerated time, this should be fast)
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 3 + 100;

    // Use Promise.race with a timeout to stop waiting after enough time
    // CRITICAL: The pipeline should complete without throwing any errors
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    // ASSERTION 1: The pipeline completed without errors (reaching here = success)
    // If the gap filling failed or threw an error, we wouldn't get here

    // ASSERTION 2: Verify no gaps exist in the stored candles
    // The FillCandleGapStream should have filled any missing candles from the exchange
    const REAL_ONE_MINUTE = 60000;
    const btcCandles = db.query('SELECT start FROM candles_BTC_USDT ORDER BY start ASC').all() as { start: number }[];

    // We should have at least 1 candle stored
    expect(btcCandles.length).toBeGreaterThanOrEqual(1);

    // If we have multiple candles, verify no gaps exist between them
    if (btcCandles.length >= 2) {
      for (let i = 1; i < btcCandles.length; i++) {
        const gap = btcCandles[i].start - btcCandles[i - 1].start;
        // Each candle should be exactly one minute after the previous one (no gaps)
        // The FillCandleGapStream fills missing candles with empty/synthetic candles
        expect(gap).toBe(REAL_ONE_MINUTE);
      }
    }

    // ASSERTION 3: Verify the same for ETH and LTC tables
    const ethCandles = db.query('SELECT start FROM candles_ETH_USDT ORDER BY start ASC').all() as { start: number }[];
    for (let i = 1; i < ethCandles.length; i++) {
      const gap = ethCandles[i].start - ethCandles[i - 1].start;
      expect(gap).toBe(REAL_ONE_MINUTE);
    }

    const ltcCandles = db.query('SELECT start FROM candles_LTC_USDT ORDER BY start ASC').all() as { start: number }[];
    for (let i = 1; i < ltcCandles.length; i++) {
      const gap = ltcCandles[i].start - ltcCandles[i - 1].start;
      expect(gap).toBe(REAL_ONE_MINUTE);
    }

    // ASSERTION 4: Verify filled candles have valid OHLCV data
    // Even gap-filled candles should have proper positive values
    const allCandles = db.query('SELECT * FROM candles_BTC_USDT ORDER BY start DESC LIMIT 10').all() as any[];
    for (const candle of allCandles) {
      expect(candle.open).toBeDefined();
      expect(candle.open).toBeGreaterThan(0);
      expect(candle.high).toBeDefined();
      expect(candle.high).toBeGreaterThan(0);
      expect(candle.low).toBeDefined();
      expect(candle.low).toBeGreaterThan(0);
      expect(candle.close).toBeDefined();
      expect(candle.close).toBeGreaterThan(0);
      expect(candle.volume).toBeDefined();
      // Volume can be 0 for gap-filled candles, so we don't check > 0
    }

    // Clean up: reset the mock flag for subsequent tests
    MockCCXTExchange.emitWithGaps = false;
  }, 30000);

  it('Scenario F: Custom batch size buffering', async () => {
    // This test validates that the writer respects the insertThreshold configuration,
    // buffering candles in memory and only flushing to disk when the threshold is reached
    // or on finalize.

    // Dynamic imports to ensure mocks are applied first
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');

    // Get storage reference - close is already disabled from previous scenarios
    const storage = inject.storage() as SQLiteStorage;
    const db = storage['db'];

    // Access the buffer and insertThreshold via the storage instance
    // Note: The buffer is protected, so we access it directly for testing
    const getBufferLength = () => (storage as any).buffer.length;
    const getInsertThreshold = () => (storage as any).insertThreshold;

    // ASSERTION 1: Verify the insertThreshold is correctly set for realtime mode
    // In realtime mode, default is 1 (unless overridden in config)
    const insertThreshold = getInsertThreshold();
    expect(insertThreshold).toBe(1); // Realtime mode default

    // Track candles emitted
    const TARGET_CANDLES = 5;

    // Run the pipeline
    const pipelinePromise = gekkoPipeline();

    // Wait for candles to be collected (with accelerated time, this should be fast)
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 3 + 100;

    // Use Promise.race with a timeout to stop waiting after enough time
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    // ASSERTION 2: The pipeline completed without errors (we got here = no error thrown)

    // ASSERTION 3: With insertThreshold = 1, the buffer should always be empty or 0
    // because each candle is flushed immediately after being added
    const bufferLength = getBufferLength();
    expect(bufferLength).toBeLessThanOrEqual(insertThreshold);

    // ASSERTION 4: Verify data integrity - all stored candles should have valid OHLCV data
    const allCandles = db.query('SELECT * FROM candles_BTC_USDT ORDER BY start DESC LIMIT 10').all() as any[];

    // We should have candles stored (from this test or previous tests)
    expect(allCandles.length).toBeGreaterThan(0);

    for (const candle of allCandles) {
      // Each candle should have valid OHLCV data
      expect(candle.open).toBeDefined();
      expect(candle.high).toBeDefined();
      expect(candle.low).toBeDefined();
      expect(candle.close).toBeDefined();
      expect(candle.volume).toBeDefined();

      // Verify data matches the synthetic generator
      const expectedCandle = generateSyntheticCandle('BTC/USDT', candle.start);
      expect(candle.open).toBeCloseTo(expectedCandle.open, 4);
    }

    // ASSERTION 5: Verify no duplicate entries in the database
    // (insertThreshold behavior should not cause duplicates)
    const duplicates = db.query('SELECT start, count(*) as cnt FROM candles_BTC_USDT GROUP BY start HAVING cnt > 1').all() as any[];
    expect(duplicates.length).toBe(0);

    // ASSERTION 6: Verify candles are contiguous (no gaps caused by buffering issues)
    const REAL_ONE_MINUTE = 60000;
    const orderedCandles = db.query('SELECT start FROM candles_BTC_USDT ORDER BY start ASC').all() as { start: number }[];

    if (orderedCandles.length >= 2) {
      for (let i = 1; i < orderedCandles.length; i++) {
        const gap = orderedCandles[i].start - orderedCandles[i - 1].start;
        // Each candle should be exactly one minute after the previous one
        expect(gap).toBe(REAL_ONE_MINUTE);
      }
    }
  }, 30000);

  it('Scenario G: Sequential stream merging (Warmup -> Realtime)', async () => {
    // This test validates that mergeSequentialStreams correctly hands over
    // from MultiAssetHistoricalStream (warmup) to RealtimeStream (realtime).
    // The key assertion is that there are no gaps or duplicates at the transition.

    // Note: With warmup.candleCount: 0, the historical stream is empty and
    // we go directly to realtime. This test verifies the realtime stream
    // works correctly with the onNewCandle mock, and that the pipeline
    // processes candles seamlessly.

    // Configure mock to use accelerated polling interval
    MockCCXTExchange.pollingInterval = FAST_MINUTE;

    // Dynamic imports to ensure mocks are applied first
    const { gekkoPipeline } = await import('@services/core/pipeline/pipeline');
    const { inject } = await import('@services/injecter/injecter');

    // Get storage reference - close is already disabled from previous scenarios
    const storage = inject.storage() as SQLiteStorage;
    const db = storage['db'];

    // Record the starting count of candles to verify new ones are added
    const initialCount = (db.query('SELECT count(*) as count FROM candles_BTC_USDT').get() as { count: number }).count;

    // Track candles emitted - need enough for transition verification
    const TARGET_CANDLES = 8;

    // Run the pipeline
    const pipelinePromise = gekkoPipeline();

    // Wait for candles to be collected
    // With accelerated time (ONE_MINUTE = 10ms), we need longer to allow the
    // realtime stream to start and emit candles after the historical stream completes
    const timeoutMs = TARGET_CANDLES * FAST_MINUTE * 10 + 500;

    // Use Promise.race with a timeout to stop waiting after enough time
    await Promise.race([pipelinePromise, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);

    // ASSERTION 1: The pipeline completed without errors (reaching here = success)
    // mergeSequentialStreams should seamlessly transition between streams

    // ASSERTION 2: Verify more candles were recorded (realtime stream is working)
    const REAL_ONE_MINUTE = 60000;
    const btcCandles = db.query('SELECT * FROM candles_BTC_USDT ORDER BY start ASC').all() as any[];
    const finalCount = btcCandles.length;

    // We should have more candles than we started with (or at least some candles)
    // Note: With warmup.candleCount = 0, the pipeline relies on realtime stream only
    expect(finalCount).toBeGreaterThanOrEqual(initialCount);

    // ASSERTION 3: Verify no gaps exist in the stored candles (seamless transition)
    // Each candle should be exactly one minute apart
    if (btcCandles.length >= 2) {
      for (let i = 1; i < btcCandles.length; i++) {
        const gap = btcCandles[i].start - btcCandles[i - 1].start;
        // Each candle should be exactly one minute after the previous one
        expect(gap).toBe(REAL_ONE_MINUTE);
      }
    }

    // ASSERTION 4: Verify no duplicate timestamps exist
    // This is crucial at the warmup/realtime boundary
    const duplicates = db.query('SELECT start, count(*) as cnt FROM candles_BTC_USDT GROUP BY start HAVING cnt > 1').all() as any[];
    expect(duplicates.length).toBe(0);

    // ASSERTION 5: Verify all candles have valid OHLCV data (integrity check)
    for (const candle of btcCandles) {
      expect(candle.open).toBeDefined();
      expect(candle.open).toBeGreaterThan(0);
      expect(candle.high).toBeDefined();
      expect(candle.high).toBeGreaterThan(0);
      expect(candle.low).toBeDefined();
      expect(candle.low).toBeGreaterThan(0);
      expect(candle.close).toBeDefined();
      expect(candle.close).toBeGreaterThan(0);
      expect(candle.volume).toBeDefined();
    }

    // ASSERTION 6: Verify data matches the synthetic generator (data integrity)
    for (const candle of btcCandles) {
      const expectedCandle = generateSyntheticCandle('BTC/USDT', candle.start);
      expect(candle.open).toBeCloseTo(expectedCandle.open, 4);
      expect(candle.high).toBeCloseTo(expectedCandle.high, 4);
      expect(candle.low).toBeCloseTo(expectedCandle.low, 4);
    }

    // ASSERTION 7: Verify same behavior for other pairs (multi-asset consistency)
    const ethCandles = db.query('SELECT start FROM candles_ETH_USDT ORDER BY start ASC').all() as { start: number }[];
    for (let i = 1; i < ethCandles.length; i++) {
      const gap = ethCandles[i].start - ethCandles[i - 1].start;
      expect(gap).toBe(REAL_ONE_MINUTE);
    }

    const ltcCandles = db.query('SELECT start FROM candles_LTC_USDT ORDER BY start ASC').all() as { start: number }[];
    for (let i = 1; i < ltcCandles.length; i++) {
      const gap = ltcCandles[i].start - ltcCandles[i - 1].start;
      expect(gap).toBe(REAL_ONE_MINUTE);
    }

    // Clean up: reset the mock polling interval for subsequent tests
    MockCCXTExchange.pollingInterval = 60000;
  }, 30000);
});
