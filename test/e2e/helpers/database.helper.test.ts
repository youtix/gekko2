import type { SQLiteStorage as ISQLiteStorage } from '@services/storage/sqlite.storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// Mocks for configuration must be defined before imports that evaluate them
mock.module('@services/configuration/configuration', () => ({
  config: {
    getStorage: () => ({ type: 'sqlite', database: ':memory:' }),
    getWatch: () => ({ mode: 'backtest' }),
  },
  debug: () => {},
}));

describe('DatabaseHelper - seedDatabaseWithCandles', () => {
  let storage: ISQLiteStorage;
  const symbol = 'BTC/USDT';
  let SQLiteStorage: any;
  let cleanDatabase: any;
  let seedDatabaseWithCandles: any;

  beforeAll(async () => {
    ({ SQLiteStorage } = await import('@services/storage/sqlite.storage'));
    ({ cleanDatabase, seedDatabaseWithCandles } = await import('./database.helper'));
  });

  beforeEach(() => {
    storage = new SQLiteStorage([symbol]);
    cleanDatabase(storage);
  });

  afterAll(() => {
    if (storage) {
      storage.close();
    }
  });

  it('should seed database with partial candles successfully', () => {
    const testScenarioCandles = [
      { start: 1000000, open: 100, high: 105, low: 95, close: 100 },
      { start: 1060000, open: 100, close: 110, volume: 50 },
    ];

    seedDatabaseWithCandles(storage, symbol, testScenarioCandles);

    const inserted = storage.getCandles(symbol, { start: 990000, end: 1100000 });

    expect(inserted).toHaveLength(2);

    // First candle
    expect(inserted[0].start).toBe(1000000);
    expect(inserted[0].open).toBe(100);
    expect(inserted[0].high).toBe(105);
    expect(inserted[0].low).toBe(95);
    expect(inserted[0].close).toBe(100);
    expect(inserted[0].volume).toBe(0); // Using default

    // Second candle - testing defaults
    expect(inserted[1].start).toBe(1060000);
    expect(inserted[1].open).toBe(100);
    expect(inserted[1].high).toBe(0); // Using default
    expect(inserted[1].low).toBe(0); // Using default
    expect(inserted[1].close).toBe(110);
    expect(inserted[1].volume).toBe(50);
  });
});
