import { Candle } from '@models/candle.types';
import { Nullable, Symbol } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { Interval } from 'date-fns';
import { upperCase } from 'lodash-es';
import { INSERT_THRESHOLD } from './storage.const';
import { CandleDateranges, MissingCandleCount } from './storage.types';

export abstract class Storage {
  protected buffer: Candle[];
  protected insertThreshold: number;

  constructor() {
    const { mode } = config.getWatch();
    const storage = config.getStorage();
    this.buffer = [];
    if (storage?.insertThreshold) this.insertThreshold = storage.insertThreshold;
    else if (mode === 'realtime') this.insertThreshold = 1;
    else this.insertThreshold = INSERT_THRESHOLD;
  }

  public addCandle(symbol: Symbol, candle: Candle) {
    this.buffer.push(candle);
    if (this.buffer.length >= this.insertThreshold) {
      this.insertCandles(symbol);
      this.buffer = [];
    }
  }

  protected getTable(symbol: Symbol) {
    const [asset, currency] = symbol.split('/');
    return `CANDLES_${upperCase(asset)}_${upperCase(currency)}`;
  }

  public abstract insertCandles(symbol: Symbol): void;
  public abstract upsertTable(symbol: Symbol): void;
  public abstract getCandleDateranges(symbol: Symbol): Nullable<CandleDateranges[]>;
  public abstract getCandles(symbol: Symbol, interval: Interval<EpochTimeStamp, EpochTimeStamp>): Candle[];
  public abstract checkInterval(
    symbol: Symbol,
    interval: Interval<EpochTimeStamp, EpochTimeStamp>,
  ): Nullable<MissingCandleCount>;
  public abstract close(): void;
}
