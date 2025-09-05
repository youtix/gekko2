import { Candle } from '@models/candle.types';
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

  constructor() {
    super();
    const { database } = config.getStorage() ?? {};
    this.db = new Database(database);
    this.db.run('PRAGMA busy_timeout = 5000;'); // Wait instead of erroring when the DB is locked
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
    this.upsertTable();
  }

  public insertCandles(): void {
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO ${this.table} VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const insertCandles = this.db.transaction((candles: Candle[]) => {
      each(candles, ({ start, open, high, low, close, volume, volumeActive, quoteVolume, quoteVolumeActive }) =>
        stmt.run(
          null,
          start,
          open,
          high,
          low,
          close,
          volume,
          volumeActive ?? 0,
          quoteVolume ?? 0,
          quoteVolumeActive ?? 0,
        ),
      );
      return candles.length;
    });
    const nbOfCandleInserted = insertCandles(this.buffer);
    debug('storage', `${nbOfCandleInserted} ${pluralize('candle', nbOfCandleInserted)} inserted in database`);
  }

  public upsertTable(): void {
    const query = `
      CREATE TABLE IF NOT EXISTS
      ${this.table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start INTEGER UNIQUE,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        volume_active REAL NOT NULL,
        quote_volume REAL NOT NULL,
        quote_volume_active REAL NOT NULL
      );
    `;
    this.db.run(query);
  }

  public getCandleDateranges() {
    const query = this.db.query<CandleDateranges, SQLQueryBindings[]>(`
      WITH gaps AS (
        SELECT start, start / 60000 - ROW_NUMBER() OVER (ORDER BY start) AS gap_group
        FROM ${this.table}
    )
    SELECT MIN(start) AS daterange_start, MAX(start) AS daterange_end
    FROM gaps
    GROUP BY gap_group
    ORDER BY daterange_start;
  `);
    return query.all();
  }

  public getCandles({ start, end }: Interval<EpochTimeStamp, EpochTimeStamp>): Candle[] {
    const query = this.db.query<Candle, SQLQueryBindings[]>(`
      SELECT id,start,open,high,low,close,volume,volume_active AS volumeActive,quote_volume AS quoteVolume,quote_volume_active AS quoteVolumeActive
      FROM ${this.table}
      WHERE start BETWEEN $start AND $end
      ORDER BY start ASC
    `);
    return query.all({ $start: start, $end: end });
  }

  public checkInterval({ start, end }: Interval<EpochTimeStamp, EpochTimeStamp>) {
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
      LEFT JOIN ${this.table} c ON c.start = e.start_time
      WHERE c.start IS NULL;
    `);
    return query.get({ $start: start, $end: end });
  }

  public close(): void {
    this.db.close(false);
  }
}
