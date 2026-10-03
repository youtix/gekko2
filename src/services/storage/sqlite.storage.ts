import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { debug } from '@services/logger';
import { pluralize } from '@utils/string/string.utils';
import { Database, SQLQueryBindings } from 'bun:sqlite';
import { Interval } from 'date-fns';
import { each } from 'lodash-es';
import { Storage } from './storage';
import { CandleDateranges, MissingCandleCount } from './storage.types';

export class SQLiteStorage extends Storage {
  db: Database;
  /** CandleWriter closes the storage when it is finalised, and main() closes it again on its way out */
  private closed = false;

  constructor(symbols: TradingPair[]) {
    super();
    const { database } = config.getStorage() ?? {};
    this.db = new Database(database);
    this.db.run('PRAGMA busy_timeout = 5000;'); // Wait instead of erroring when the DB is locked
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
    each(symbols, symbol => this.upsertTable(symbol));
  }

  public insertCandles(symbol: TradingPair): void {
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO ${this.getQuotedTable(symbol)} VALUES (?,?,?,?,?,?,?)`);
    // A statement left open keeps the connection alive after close(false): the WAL is never checkpointed into the database file
    try {
      const insertCandles = this.db.transaction((bucket: CandleBucket[]) => {
        const candles = bucket.flatMap(b => b.get(symbol) ?? []);
        each(candles, ({ start, open, high, low, close, volume }) => stmt.run(null, start, open, high, low, close, volume));
        return candles.length;
      });
      const nbOfCandleInserted = insertCandles(this.buffer);
      debug('storage', `${nbOfCandleInserted} ${symbol} ${pluralize('candle', nbOfCandleInserted)} inserted in database`);
    } finally {
      stmt.finalize();
    }
  }

  public upsertTable(symbol: TradingPair): void {
    const query = `
      CREATE TABLE IF NOT EXISTS
      ${this.getQuotedTable(symbol)} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start INTEGER UNIQUE,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL
      );
    `;
    this.db.run(query);
  }

  public getCandleDateranges(symbol: TradingPair) {
    const query = this.db.query<CandleDateranges, SQLQueryBindings[]>(`
      WITH gaps AS (
        SELECT start, start / 60000 - ROW_NUMBER() OVER (ORDER BY start) AS gap_group
        FROM ${this.getQuotedTable(symbol)}
    )
    SELECT MIN(start) AS daterange_start, MAX(start) AS daterange_end
    FROM gaps
    GROUP BY gap_group
    ORDER BY daterange_start;
  `);
    return query.all();
  }

  public getCandles(symbol: TradingPair, { start, end }: Interval<EpochTimeStamp, EpochTimeStamp>): Candle[] {
    const query = this.db.query<Candle, SQLQueryBindings[]>(`
      SELECT id,start,open,high,low,close,volume
      FROM ${this.getQuotedTable(symbol)}
      WHERE start BETWEEN $start AND $end
      ORDER BY start ASC
    `);
    return query.all({ $start: start, $end: end });
  }

  public checkInterval(symbol: TradingPair, { start, end }: Interval<EpochTimeStamp, EpochTimeStamp>) {
    const query = this.db.query<MissingCandleCount, SQLQueryBindings[]>(`
      WITH RECURSIVE expected(start_time) AS (
        SELECT $start AS start_time
        UNION ALL
        SELECT start_time + 60000
        FROM expected
        WHERE start_time < $end
      )
      SELECT COUNT(*) AS missingCandleCount
      FROM expected e
      LEFT JOIN ${this.getQuotedTable(symbol)} c ON c.start = e.start_time
      WHERE c.start IS NULL;
    `);
    return query.get({ $start: start, $end: end });
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      // Without it, a crash or a stop outside the plugins (main()'s uncaughtException handler) would lose the buffered buckets
      this.flush();
      // Copies the WAL into the database file and empties it, so that the file alone holds every candle (a copy, a backup)
      this.db.run('PRAGMA wal_checkpoint(TRUNCATE);');
    } finally {
      this.db.close(false);
    }
  }

  /** Tickers can hold digits and punctuation (1INCH, USDC:USDC), so the name is always quoted, its own quotes doubled. */
  private getQuotedTable(symbol: TradingPair) {
    return `"${this.getTable(symbol).replaceAll('"', '""')}"`;
  }
}
