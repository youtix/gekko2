import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { Nullable, TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { Interval } from 'date-fns';
import { upperCase } from 'lodash-es';
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
    if (this.buffer.length >= this.insertThreshold) {
      bucket.keys().forEach(symbol => this.insertCandles(symbol));
      this.buffer = [];
    }
  }

  protected getTable(symbol: TradingPair) {
    const [asset, currency] = symbol.split('/');
    return `CANDLES_${upperCase(asset)}_${upperCase(currency)}`;
  }

  public abstract insertCandles(symbol: TradingPair): void;
  public abstract upsertTable(symbol: TradingPair): void;
  public abstract getCandleDateranges(symbol: TradingPair): Nullable<CandleDateranges[]>;
  public abstract getCandles(symbol: TradingPair, interval: Interval<EpochTimeStamp, EpochTimeStamp>): Candle[];
  public abstract checkInterval(symbol: TradingPair, interval: Interval<EpochTimeStamp, EpochTimeStamp>): Nullable<MissingCandleCount>;
  public abstract close(): void;
}
