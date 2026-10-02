import type { SQLiteStorage as ISQLiteStorage } from '@services/storage/sqlite.storage';
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// Mocks for configuration must be defined before imports that evaluate them
mock.module('@services/configuration/configuration', () => ({
  config: {
    getStorage: () => ({ type: 'sqlite', database: ':memory:', insertThreshold: 1 }),
    getWatch: () => ({ mode: 'backtest' }),
  },
}));

const MINUTE = 60_000;
const start = 1_700_000_040_000;
const end = start + 3 * MINUTE;
// Minute 2 is missing: one gap, so two date ranges
const candles = [0, 1, 3].map(minute => ({ start: start + minute * MINUTE, open: 10, high: 12, low: 9, close: 11, volume: minute + 1 }));

describe('SQLiteStorage - table names', () => {
  let SQLiteStorage: typeof ISQLiteStorage;

  beforeAll(async () => {
    ({ SQLiteStorage } = await import('@services/storage/sqlite.storage'));
  });

  describe.each([
    ['BTC/USDT', 'CANDLES_BTC_USDT'],
    ['1INCH/USDT', 'CANDLES_1INCH_USDT'],
    ['C98/USDT', 'CANDLES_C98_USDT'],
    ['1000SATS/USDT', 'CANDLES_1000SATS_USDT'],
    ['BTC/USD1', 'CANDLES_BTC_USD1'],
    ['FLX-CRCL/USDC:USDC', 'CANDLES_FLX-CRCL_USDC:USDC'],
    ['A"B/USDT', 'CANDLES_A"B_USDT'],
  ] as const)('%s', (symbol, table) => {
    let storage: ISQLiteStorage;

    beforeEach(() => {
      storage = new SQLiteStorage([symbol]);
      candles.forEach(candle => storage.addCandle(new Map([[symbol, candle]])));
    });

    afterEach(() => {
      storage.close();
    });

    it(`creates the table ${table}`, () => {
      expect(storage.db.query('SELECT name FROM sqlite_master WHERE name LIKE ?').all('CANDLES%')).toEqual([{ name: table }]);
    });

    it('reads back the inserted candles', () => {
      expect(storage.getCandles(symbol, { start, end })).toEqual(candles.map((candle, index) => ({ id: index + 1, ...candle })));
    });

    it('lists the date ranges of the candles', () => {
      expect(storage.getCandleDateranges(symbol)).toEqual([
        { daterange_start: start, daterange_end: start + MINUTE },
        { daterange_start: end, daterange_end: end },
      ]);
    });

    it('counts the missing candles of the interval', () => {
      expect(storage.checkInterval(symbol, { start, end })).toEqual({ missingCandleCount: 1 });
    });
  });

  it('reads a table created by the former, unquoted statement', () => {
    const storage = new SQLiteStorage([]);
    storage.db.run(
      'CREATE TABLE IF NOT EXISTS CANDLES_BTC_USDT (id INTEGER PRIMARY KEY AUTOINCREMENT, start INTEGER UNIQUE, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL)',
    );
    storage.db.run('INSERT INTO CANDLES_BTC_USDT VALUES (NULL, ?, 10, 12, 9, 11, 1)', [start]);
    storage.upsertTable('btc/usdt');
    expect(storage.getCandles('btc/usdt', { start, end })).toEqual([{ id: 1, ...candles[0] }]);
    storage.close();
  });
});
