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
    const storage = config.getStorage();
    this.buffer = [];
    if (storage?.insertThreshold) this.insertThreshold = storage.insertThreshold;
    else if (mode === 'realtime') this.insertThreshold = 1;
    else this.insertThreshold = INSERT_THRESHOLD;
  }

  public addCandle(bucket: CandleBucket) {
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
  public abstract upsertTable(symbol: TradingPair): void;
  public abstract getCandleDateranges(symbol: TradingPair): Nullable<CandleDateranges[]>;
  public abstract getCandles(symbol: TradingPair, interval: Interval<EpochTimeStamp, EpochTimeStamp>): Candle[];
  public abstract checkInterval(symbol: TradingPair, interval: Interval<EpochTimeStamp, EpochTimeStamp>): Nullable<MissingCandleCount>;
  /** Inserts the buffered candles, then closes the connection. */
  public abstract close(): void;
}
