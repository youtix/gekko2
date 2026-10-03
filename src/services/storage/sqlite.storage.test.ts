import { debug } from '@services/logger';
import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SQLiteStorage } from './sqlite.storage';

const { mockConfig, mockDb } = vi.hoisted(() => ({
  mockConfig: { getWatch: vi.fn(), getStorage: vi.fn() },
  mockDb: { run: vi.fn(), prepare: vi.fn(), query: vi.fn(), transaction: vi.fn(), close: vi.fn() },
}));

vi.mock('@services/configuration/configuration', () => ({ config: mockConfig }));
vi.mock('@services/logger', () => ({ debug: vi.fn() }));
vi.mock('bun:sqlite', () => ({
  Database: vi.fn(function () {
    return mockDb;
  }),
}));

/** Runs a call that is expected to throw and swallows the error, so that the test can check what happened around it */
const attempt = (call: () => void) => {
  try {
    call();
  } catch {
    // Expected
  }
};

describe('SQLiteStorage', () => {
  const symbol = 'A"B/USDT';
  const interval = { start: 0, end: 0 };
  const candle = { start: 1, open: 2, high: 3, low: 4, close: 5, volume: 6 };
  let storage: SQLiteStorage;

  beforeEach(() => {
    mockConfig.getWatch.mockReturnValue({ mode: 'backtest' });
    mockConfig.getStorage.mockReturnValue({ type: 'sqlite', database: ':memory:' });
    mockDb.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), finalize: vi.fn() });
    mockDb.query.mockReturnValue({ all: vi.fn(), get: vi.fn() });
    mockDb.transaction.mockImplementation(fn => fn);
    storage = new SQLiteStorage([]);
  });

  it.each`
    method                   | call                                             | sqlRunBy
    ${'createTable'}         | ${() => storage.createTable(symbol)}             | ${mockDb.run}
    ${'insertCandles'}       | ${() => storage.insertCandles(symbol)}           | ${mockDb.prepare}
    ${'getCandleDateranges'} | ${() => storage.getCandleDateranges(symbol)}     | ${mockDb.query}
    ${'getCandles'}          | ${() => storage.getCandles(symbol, interval)}    | ${mockDb.query}
    ${'checkInterval'}       | ${() => storage.checkInterval(symbol, interval)} | ${mockDb.query}
  `('quotes the table name in the SQL of $method, doubling its quotes', ({ call, sqlRunBy }) => {
    call();
    expect(sqlRunBy.mock.lastCall?.[0]).toContain('"CANDLES_A""B_USDT"');
  });

  it.each`
    method             | call
    ${'getCandles'}    | ${() => storage.getCandles(symbol, interval)}
    ${'checkInterval'} | ${() => storage.checkInterval(symbol, interval)}
  `('reads only the rows that start a minute in $method, like the other one', ({ call }) => {
    call();
    expect(mockDb.query.mock.lastCall?.[0]).toContain('WHERE start BETWEEN $start AND $end AND start % 60000 = 0');
  });

  it.each`
    storageConfig                                     | path
    ${{ type: 'sqlite', database: 'candles.sqlite' }} | ${'candles.sqlite'}
    ${undefined}                                      | ${undefined}
  `('opens the database $path', ({ storageConfig, path }) => {
    mockConfig.getStorage.mockReturnValue(storageConfig);
    new SQLiteStorage([]);
    expect(Database).toHaveBeenLastCalledWith(path);
  });

  it('creates the table of every pair it is given', () => {
    new SQLiteStorage(['BTC/USDT', 'ETH/USDT']);
    expect(mockDb.run.mock.calls.filter(([sql]) => sql.includes('CREATE TABLE'))).toHaveLength(2);
  });

  it('inserts the buffered candles of the pair, skipping the buckets without it', () => {
    const statement = { run: vi.fn(() => ({ changes: 1 })), finalize: vi.fn() };
    mockDb.prepare.mockReturnValue(statement);
    storage.addBucket(new Map([['BTC/USDT', { start: 1, open: 2, high: 3, low: 4, close: 5, volume: 6 }]]));
    storage.addBucket(new Map([['ETH/USDT', { start: 1, open: 2, high: 3, low: 4, close: 5, volume: 6 }]]));
    storage.insertCandles('BTC/USDT');
    expect(statement.run.mock.calls).toEqual([[1, 2, 3, 4, 5, 6]]);
  });

  describe('insertCandles', () => {
    const statement = { run: vi.fn(() => ({ changes: 1 })), finalize: vi.fn() };

    beforeEach(() => {
      mockDb.prepare.mockReturnValue(statement);
      storage.addBucket(new Map([['BTC/USDT', { start: 1, open: 2, high: 3, low: 4, close: 5, volume: 6 }]]));
    });

    it('replaces a stored minute only when it is flat without volume and the new candle traded', () => {
      storage.insertCandles('BTC/USDT');
      expect(mockDb.prepare.mock.lastCall?.[0].replace(/\s+/g, ' ')).toContain(
        'ON CONFLICT(start) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume WHERE "CANDLES_BTC_USDT".volume = 0 AND "CANDLES_BTC_USDT".open = "CANDLES_BTC_USDT".high AND "CANDLES_BTC_USDT".high = "CANDLES_BTC_USDT".low AND "CANDLES_BTC_USDT".low = "CANDLES_BTC_USDT".close AND excluded.volume > 0',
      );
    });

    it.each`
      changes   | message
      ${[1, 1]} | ${'2 BTC/USDT candles written in database'}
      ${[1, 0]} | ${'1 BTC/USDT candle written in database'}
      ${[0, 0]} | ${'0 BTC/USDT candle written in database'}
    `('logs the rows actually written, $changes, not the candles it tried', ({ changes, message }) => {
      for (const count of changes) statement.run.mockReturnValueOnce({ changes: count });
      storage.addBucket(new Map([['BTC/USDT', { start: 2, open: 2, high: 3, low: 4, close: 5, volume: 6 }]]));
      storage.insertCandles('BTC/USDT');
      expect(debug).toHaveBeenLastCalledWith('storage', message);
    });

    it('finalizes the insert statement', () => {
      storage.insertCandles('BTC/USDT');
      expect(statement.finalize).toHaveBeenCalledOnce();
    });

    it('rethrows a failed insert', () => {
      statement.run.mockImplementation(() => {
        throw new Error('disk full');
      });
      expect(() => storage.insertCandles('BTC/USDT')).toThrow('disk full');
    });

    it('finalizes the insert statement when an insert fails', () => {
      statement.run.mockImplementation(() => {
        throw new Error('disk full');
      });
      attempt(() => storage.insertCandles('BTC/USDT'));
      expect(statement.finalize).toHaveBeenCalledOnce();
    });
  });

  describe('close', () => {
    it('closes the database', () => {
      storage.close();
      expect(mockDb.close).toHaveBeenCalledWith(false);
    });

    it('checkpoints the WAL into the database file before closing', () => {
      storage.close();
      const checkpointCall = mockDb.run.mock.calls.findIndex(([sql]) => sql === 'PRAGMA wal_checkpoint(TRUNCATE);');
      expect(mockDb.run.mock.invocationCallOrder[checkpointCall]).toBeLessThan(mockDb.close.mock.invocationCallOrder[0]);
    });

    it('still closes the database when the checkpoint fails', () => {
      mockDb.run.mockImplementation(sql => {
        if (sql.startsWith('PRAGMA wal_checkpoint')) throw new Error('database is locked');
      });
      attempt(() => storage.close());
      expect(mockDb.close).toHaveBeenCalledOnce();
    });

    it.each`
      scenario              | buckets                                     | inserted
      ${'an empty buffer'}  | ${[]}                                       | ${[]}
      ${'buffered buckets'} | ${[['BTC/USDT'], ['BTC/USDT', 'ETH/USDT']]} | ${[[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]]}
    `('inserts the candles of $scenario before closing', ({ buckets, inserted }) => {
      const statement = { run: vi.fn(() => ({ changes: 1 })), finalize: vi.fn() };
      mockDb.prepare.mockReturnValue(statement);
      mockConfig.getStorage.mockReturnValue({ type: 'sqlite', database: ':memory:', insertThreshold: 10 });
      storage = new SQLiteStorage([]);
      for (const symbols of buckets) storage.addBucket(new Map(symbols.map((symbol: string) => [symbol, candle])));
      storage.close();
      expect(statement.run.mock.calls).toEqual(inserted);
    });

    it('inserts the buffered candles before checkpointing the WAL', () => {
      const statement = { run: vi.fn(() => ({ changes: 1 })), finalize: vi.fn() };
      mockDb.prepare.mockReturnValue(statement);
      mockConfig.getStorage.mockReturnValue({ type: 'sqlite', database: ':memory:', insertThreshold: 10 });
      storage = new SQLiteStorage([]);
      storage.addBucket(new Map([['BTC/USDT', candle]]));
      storage.close();
      const checkpointCall = mockDb.run.mock.calls.findIndex(([sql]) => sql === 'PRAGMA wal_checkpoint(TRUNCATE);');
      expect(statement.run.mock.invocationCallOrder[0]).toBeLessThan(mockDb.run.mock.invocationCallOrder[checkpointCall]);
    });

    it('does nothing when the database is already closed', () => {
      storage.close();
      storage.close();
      expect(mockDb.close).toHaveBeenCalledOnce();
    });
  });
});
