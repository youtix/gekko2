import { Candle } from '@models/types/candle.types';
import { Broker } from '@services/broker/broker';
import { Heart } from '@services/core/heart/heart';
import { HistoricalCandleError } from '@services/core/stream/historicalCandle/historicalCandle.error';
import { inject } from '@services/injecter/injecter';
import { info } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { formatDuration, intervalToDuration, isAfter, isBefore } from 'date-fns';
import { bindAll, each, filter, last } from 'lodash-es';
import { Readable } from 'stream';
import { HistoricalCandleStreamInput } from './historicalCandle.types';

export class HistoricalCandleStream extends Readable {
  private start: EpochTimeStamp;
  private end: EpochTimeStamp;
  private heart: Heart;
  private broker: Broker;
  private isLocked: boolean;

  constructor({ startDate, endDate, tickrate = 1 }: HistoricalCandleStreamInput) {
    super({ objectMode: true });

    this.start = resetDateParts(startDate, ['s', 'ms']);
    this.end = resetDateParts(endDate, ['s', 'ms']);

    this.heart = new Heart(tickrate);
    this.broker = inject.broker();
    this.isLocked = false;

    bindAll(this, ['pushCandles', 'pushCandle', 'onTick']);

    info(
      'stream',
      [
        `Fetching historical data from ${toISOString(this.start)}`,
        `to ${toISOString(this.end)}`,
        `(${formatDuration(intervalToDuration({ start: this.start, end: this.end }))})`,
      ].join(' '),
    );

    this.heart.on('tick', this.onTick);

    // Close stream if nothing to download
    if (!isBefore(this.start, this.end)) this.push(null);
    else this.heart.pump();
  }

  async onTick() {
    if (this.isLocked) return;
    this.isLocked = true;
    const candles = await this.broker.fetchOHLCV(this.start);
    if (!candles?.length) throw new HistoricalCandleError('No candle data was fetched.');
    this.start = last(candles)?.start ?? Number.MAX_SAFE_INTEGER;
    this.start++;
    if (!isBefore(this.start, this.end)) {
      this.pushCandles(filter(candles, candle => !isAfter(candle.start, this.end)));
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
