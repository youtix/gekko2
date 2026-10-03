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
    each(symbols, symbol => this.createTable(symbol));
  }

  public insertCandles(symbol: TradingPair): void {
    const table = this.getQuotedTable(symbol);
    // A stored minute is only replaced when it looks like a candle made up by FillCandleGapStream (flat, no volume) and the new
    // one has traded: a later import then corrects the minutes a realtime run had to invent, and never overwrites real data.
    const stmt = this.db.prepare(`
      INSERT INTO ${table} (start, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(start) DO UPDATE SET
        open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume
      WHERE ${table}.volume = 0 AND ${table}.open = ${table}.high AND ${table}.high = ${table}.low AND ${table}.low = ${table}.close
        AND excluded.volume > 0
    `);
    // A statement left open keeps the connection alive after close(false): the WAL is never checkpointed into the database file
    try {
      const insertCandles = this.db.transaction((buffer: CandleBucket[]) => {
        let written = 0; // Rows inserted or replaced, not the minutes already stored that were left as they were
        for (const bucket of buffer) {
          const candle = bucket.get(symbol);
          if (candle) written += stmt.run(candle.start, candle.open, candle.high, candle.low, candle.close, candle.volume).changes;
        }
        return written;
      });
      const written = insertCandles(this.buffer);
      debug('storage', `${written} ${symbol} ${pluralize('candle', written)} written in database`);
    } finally {
      stmt.finalize();
    }
  }

  public createTable(symbol: TradingPair): void {
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
      WHERE start BETWEEN $start AND $end AND start % 60000 = 0
      ORDER BY start ASC
    `);
    return query.all({ $start: start, $end: end });
  }

  /** The minutes of the interval with no candle. Its bounds must be starts of minutes, as the stored candles are. */
  public checkInterval(symbol: TradingPair, { start, end }: Interval<EpochTimeStamp, EpochTimeStamp>) {
    const query = this.db.query<MissingCandleCount, SQLQueryBindings[]>(`
      SELECT ($end - $start) / 60000 + 1 - COUNT(*) AS missingCandleCount
      FROM ${this.getQuotedTable(symbol)}
      WHERE start BETWEEN $start AND $end AND start % 60000 = 0
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
