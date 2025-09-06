import { Candle } from '@models/candle.types';
import { Heart } from '@services/core/heart/heart';
import { HistoricalCandleError } from '@services/core/stream/historicalCandle/historicalCandle.error';
import { Exchange } from '@services/exchange/exchange';
import { inject } from '@services/injecter/injecter';
import { info } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { formatDuration, intervalToDuration, isAfter, isBefore } from 'date-fns';
import { bindAll, each, filter, last } from 'lodash-es';
import { Readable } from 'stream';
import { HistoricalCandleStreamInput } from './historicalCandle.types';

export class HistoricalCandleStream extends Readable {
  private startDate: EpochTimeStamp;
  private endDate: EpochTimeStamp;
  private heart: Heart;
  private exchange: Exchange;
  private isLocked: boolean;

  constructor({ startDate, endDate, tickrate }: HistoricalCandleStreamInput) {
    super({ objectMode: true });

    this.startDate = resetDateParts(startDate, ['s', 'ms']);
    this.endDate = resetDateParts(endDate, ['s', 'ms']);

    this.heart = new Heart(tickrate);
    this.exchange = inject.exchange();
    this.isLocked = false;

    bindAll(this, ['pushCandles', 'pushCandle', 'onTick']);

    this.heart.on('tick', this.onTick);

    // Close stream if nothing to download
    if (!isBefore(this.startDate, this.endDate)) {
      info('stream', 'No historical data to download');
      process.nextTick(() => this.push(null));
    } else {
      info(
        'stream',
        [
          `Fetching historical data from ${toISOString(this.startDate)}`,
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
    const candles = await this.exchange.getKlines(this.startDate);
    if (!candles?.length) throw new HistoricalCandleError('No candle data was fetched.');
    this.startDate = last(candles)?.start ?? Number.MAX_SAFE_INTEGER;
    this.startDate++;
    if (!isBefore(this.startDate, this.endDate)) {
      this.pushCandles(filter(candles, candle => !isAfter(candle.start, this.endDate)));
      this.push(null);
      this.heart.stop();
    } else this.pushCandles(candles);
    this.isLocked = false;
  }

  _read(): void {
    // No operation, as data is pushed manually
  }

  pushCandles(candles: Candle[]): void {
    each(candles, this.pushCandle);
  }

  pushCandle(candle: Candle): void {
    // console.log({ clazz: 'HistoricalCandleStream', candle: toISOString(candle.start) });
    this.push(candle);
  }
}
