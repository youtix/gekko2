import { Candle } from '@models/types/candle.types';
import { Nullable } from '@models/types/generic.types';
import { config } from '@services/configuration/configuration';
import { Interval } from 'date-fns';
import { upperCase } from 'lodash-es';
import { INSERT_THRESHOLD } from './storage.const';
import { CandleDateranges, MissingCandleCount } from './storage.types';

export abstract class Storage {
  protected buffer: Candle[];
  protected table: string;
  protected insertThreshold: number;

  constructor() {
    const { asset, currency, mode } = config.getWatch();
    const storage = config.getStorage();
    this.buffer = [];
    this.table = `CANDLES_${upperCase(asset)}_${upperCase(currency)}`;
    if (storage?.insertThreshold) this.insertThreshold = storage.insertThreshold;
    else if (mode === 'realtime') this.insertThreshold = 1;
    else this.insertThreshold = INSERT_THRESHOLD;
  }

  public addCandle(candle: Candle) {
    this.buffer.push(candle);
    if (this.buffer.length >= this.insertThreshold) {
      this.insertCandles();
      this.buffer = [];
    }
  }

  public abstract insertCandles(): void;
  public abstract upsertTable(): void;
  public abstract getCandleDateranges(): Nullable<CandleDateranges[]>;
  public abstract getCandles(interval: Interval<EpochTimeStamp, EpochTimeStamp>): Candle[];
  public abstract checkInterval(interval: Interval<EpochTimeStamp, EpochTimeStamp>): Nullable<MissingCandleCount>;
  public abstract close(): void;
}
