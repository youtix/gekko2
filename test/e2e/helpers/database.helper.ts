import type { SQLiteStorage } from '@services/storage/sqlite.storage';

export const cleanDatabase = (storage: SQLiteStorage) => {
  const db = storage.db;
  // eslint-disable-next-line quotes
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'candles_%'").all() as { name: string }[];

  for (const { name } of tables) {
    db.run(`DELETE FROM ${name}`);
  }
};
