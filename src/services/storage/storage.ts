import { Candle } from '@models/types/candle.types';
import { Nullable } from '@models/types/generic.types';
import { config } from '@services/configuration/configuration';
import { Interval } from 'date-fns';
import { upperCase } from 'lodash-es';
import { CandleDateranges, MissingCandleCount } from './storage.types';

export abstract class Storage {
  protected buffer: Candle[];
  protected table: string;

  constructor() {
    const { asset, currency } = config.getWatch();
    this.buffer = [];
    this.table = `CANDLES_${upperCase(asset)}_${upperCase(currency)}`;
  }

  public addCandle(candle: Candle) {
    this.buffer = [...this.buffer, candle];
    if (this.buffer.length >= 1000) {
      this.insertCandles();
      this.buffer = [];
    }
  }

  public abstract insertCandles(): void;
  public abstract upsertTable(): void;
  public abstract getCandleDateranges(): Nullable<CandleDateranges[]>;
  public abstract getCandles(interval: Interval<EpochTimeStamp, EpochTimeStamp>): Candle[];
  public abstract checkInterval(
    interval: Interval<EpochTimeStamp, EpochTimeStamp>,
  ): Nullable<MissingCandleCount>;
  public abstract close(): void;
}
