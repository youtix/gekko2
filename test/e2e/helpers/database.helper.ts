import { Candle } from '@models/candle.types';
import { TradingPair } from '@models/utility.types';
import type { SQLiteStorage } from '@services/storage/sqlite.storage';
import { upperCase } from 'lodash-es';

export const cleanDatabase = (storage: SQLiteStorage) => {
  const db = storage.db;
  // eslint-disable-next-line quotes
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'candles_%'").all() as { name: string }[];

  for (const { name } of tables) {
    db.run(`DELETE FROM ${name}`);
  }
};

export const seedDatabaseWithCandles = (storage: SQLiteStorage, symbol: TradingPair, candles: Partial<Candle>[]) => {
  storage.upsertTable(symbol);

  const [asset, currency] = symbol.split('/');
  const tableName = `CANDLES_${upperCase(asset)}_${upperCase(currency)}`;

  const stmt = storage.db.prepare(`INSERT INTO ${tableName} (start, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?)`);

  const insertTx = storage.db.transaction((records: Partial<Candle>[]) => {
    for (const record of records) {
      if (record.start === undefined) {
        throw new Error('Candle must have a start time');
      }
      stmt.run(record.start, record.open ?? 0, record.high ?? 0, record.low ?? 0, record.close ?? 0, record.volume ?? 0);
    }
  });

  insertTx(candles);
};
