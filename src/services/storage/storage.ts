import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { Nullable, TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { Interval } from 'date-fns';
import { toUpper } from 'lodash-es';
import { INSERT_THRESHOLD } from './storage.const';
import { CandleDateranges, MissingCandleCount } from './storage.types';

export abstract class Storage {
  protected buffer: CandleBucket[];
  protected insertThreshold: number;

  constructor() {
    const { mode } = config.getWatch();
    this.buffer = [];
    // Realtime writes each minute as it closes; the importer batches its inserts
    this.insertThreshold = config.getStorage()?.insertThreshold ?? (mode === 'realtime' ? 1 : INSERT_THRESHOLD);
  }

  public addBucket(bucket: CandleBucket) {
    this.buffer.push(bucket);
    if (this.buffer.length >= this.insertThreshold) this.flush();
  }

  /** Inserts the candles of every pair the buffer holds, not only the pairs of its last bucket, then empties it. */
  protected flush() {
    const symbols = new Set<TradingPair>();
    for (const bucket of this.buffer) for (const symbol of bucket.keys()) symbols.add(symbol);
    for (const symbol of symbols) this.insertCandles(symbol);
    this.buffer = [];
  }

  protected getTable(symbol: TradingPair) {
    const [asset, currency] = symbol.split('/');
    // Not upperCase: it splits words with spaces (1INCH becomes '1 INCH'). Letter-only tickers keep the names they always had.
    return `CANDLES_${toUpper(asset)}_${toUpper(currency)}`;
  }

  public abstract insertCandles(symbol: TradingPair): void;
  public abstract createTable(symbol: TradingPair): void;
  public abstract getCandleDateranges(symbol: TradingPair): Nullable<CandleDateranges[]>;
  public abstract getCandles(symbol: TradingPair, interval: Interval<EpochTimeStamp, EpochTimeStamp>): Candle[];
  public abstract checkInterval(symbol: TradingPair, interval: Interval<EpochTimeStamp, EpochTimeStamp>): Nullable<MissingCandleCount>;
  /** Inserts the buffered candles, then closes the connection. */
  public abstract close(): void;
}
