import { Candle } from '@models/candle.types';
import { TradingPair } from '@models/utility.types';
import { Heart } from '@services/core/heart/heart';
import { HistoricalCandleError } from '@services/core/stream/historicalCandle/historicalCandle.error';
import { Exchange } from '@services/exchange/exchange.types';
import { inject } from '@services/injecter/injecter';
import { info } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { formatDuration, Interval, intervalToDuration, isAfter, isBefore } from 'date-fns';
import { bindAll, each, filter, last } from 'lodash-es';
import { Readable } from 'stream';

export interface HistoricalCandleStreamParams {
  daterange: Interval<EpochTimeStamp, EpochTimeStamp>;
  tickrate: number;
  symbol: TradingPair;
}

export class HistoricalCandleStream extends Readable {
  private startDate: EpochTimeStamp;
  private endDate: EpochTimeStamp;
  private heart: Heart;
  private exchange: Exchange;
  private isLocked: boolean;
  private symbol: TradingPair;
  private initialStartDate: EpochTimeStamp;
  private importedCandles: number;
  private lastProgressLog: number;
  private totalDuration: number;

  constructor({ daterange, tickrate, symbol }: HistoricalCandleStreamParams) {
    super({ objectMode: true });

    this.startDate = resetDateParts(daterange.start, ['s', 'ms']);
    this.endDate = resetDateParts(daterange.end, ['s', 'ms']);

    this.initialStartDate = this.startDate;
    this.totalDuration = this.endDate - this.startDate;
    this.importedCandles = 0;
    this.lastProgressLog = 0;

    this.heart = new Heart(tickrate);
    this.exchange = inject.exchange();
    this.isLocked = false;
    this.symbol = symbol;

    bindAll(this, [this.pushCandles.name, this.pushCandle.name, this.onTick.name]);

    this.heart.on('tick', this.onTick);

    // Close stream if nothing to download
    if (!isBefore(this.startDate, this.endDate)) {
      info('stream', `[${symbol}] No historical data to download`);
      process.nextTick(() => this.push(null));
    } else {
      info(
        'stream',
        [
          `[${symbol}] Fetching historical data from ${toISOString(this.startDate)}`,
          `to ${toISOString(this.endDate)}`,
          `(${formatDuration(intervalToDuration({ start: this.startDate, end: this.endDate }))})`,
        ].join(' '),
      );
      this.heart.pump();
    }
  }

  async onTick() {
    if (this.isLocked) return;
    this.isLocked = true;
    try {
      const candles = await this.exchange.fetchOHLCV(this.symbol, { from: this.startDate });
      if (!candles?.length) throw new HistoricalCandleError(`[${this.symbol}] No candle data was fetched.`);

      this.importedCandles += candles.length;
      this.logProgress();

      this.startDate = last(candles)?.start ?? Number.MAX_SAFE_INTEGER;
      this.startDate++;
      if (!isBefore(this.startDate, this.endDate)) {
        this.pushCandles(filter(candles, candle => !isAfter(candle.start, this.endDate)));
        this.push(null);
        this.heart.stop();
      } else this.pushCandles(candles);
    } catch (error) {
      this.emit('error', error);
      this.heart.stop(); // Stop heart on error to prevent infinite loop of errors
    } finally {
      this.isLocked = false;
    }
  }

  private logProgress() {
    if (this.totalDuration <= 0) return;

    const currentDuration = this.startDate - this.initialStartDate;
    const progress = Math.min(100, Math.floor((currentDuration / this.totalDuration) * 100));

    // Log progress every 1%
    if (progress >= this.lastProgressLog + 1) {
      info('stream', `[${this.symbol}] Importing: ${progress}% (${toISOString(this.startDate)})`);
      this.lastProgressLog = progress;
    }
  }

  public getStats() {
    return { symbol: this.symbol, count: this.importedCandles };
  }

  _read(): void {
    // No operation, as data is pushed manually
  }

  pushCandles(candles: Candle[]): void {
    each(candles, this.pushCandle);
  }

  pushCandle(candle: Candle): void {
    this.push({ symbol: this.symbol, candle });
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    try {
      this.heart.stop();
    } finally {
      callback(error);
    }
  }
}
