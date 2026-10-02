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

describe('SQLiteStorage', () => {
  const symbol = 'A"B/USDT';
  const interval = { start: 0, end: 0 };
  let storage: SQLiteStorage;

  beforeEach(() => {
    mockConfig.getWatch.mockReturnValue({ mode: 'backtest' });
    mockConfig.getStorage.mockReturnValue({ type: 'sqlite', database: ':memory:' });
    mockDb.prepare.mockReturnValue({ run: vi.fn() });
    mockDb.query.mockReturnValue({ all: vi.fn(), get: vi.fn() });
    mockDb.transaction.mockImplementation(fn => fn);
    storage = new SQLiteStorage([]);
  });

  it.each`
    method                   | call                                             | sqlRunBy
    ${'upsertTable'}         | ${() => storage.upsertTable(symbol)}             | ${mockDb.run}
    ${'insertCandles'}       | ${() => storage.insertCandles(symbol)}           | ${mockDb.prepare}
    ${'getCandleDateranges'} | ${() => storage.getCandleDateranges(symbol)}     | ${mockDb.query}
    ${'getCandles'}          | ${() => storage.getCandles(symbol, interval)}    | ${mockDb.query}
    ${'checkInterval'}       | ${() => storage.checkInterval(symbol, interval)} | ${mockDb.query}
  `('quotes the table name in the SQL of $method, doubling its quotes', ({ call, sqlRunBy }) => {
    call();
    expect(sqlRunBy.mock.lastCall?.[0]).toContain('"CANDLES_A""B_USDT"');
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
    const statement = { run: vi.fn() };
    mockDb.prepare.mockReturnValue(statement);
    storage.addCandle(new Map([['BTC/USDT', { start: 1, open: 2, high: 3, low: 4, close: 5, volume: 6 }]]));
    storage.addCandle(new Map([['ETH/USDT', { start: 1, open: 2, high: 3, low: 4, close: 5, volume: 6 }]]));
    storage.insertCandles('BTC/USDT');
    expect(statement.run.mock.calls).toEqual([[null, 1, 2, 3, 4, 5, 6]]);
  });

  it('closes the database', () => {
    storage.close();
    expect(mockDb.close).toHaveBeenCalledWith(false);
  });
});
