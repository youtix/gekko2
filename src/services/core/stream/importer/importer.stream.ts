import { ImporterError } from '@errors/importer.error';
import { Candle } from '@models/types/candle.types';
import { Broker } from '@services/broker/broker';
import { config } from '@services/configuration/configuration';
import { Heart } from '@services/core/heart/heart';
import { logger } from '@services/logger';
import { inject } from '@services/storage/injecter/injecter';
import { toISOString, toTimestamp } from '@utils/date/date.utils';
import { formatDuration, intervalToDuration, isAfter, isBefore } from 'date-fns';
import { bindAll, each, filter, last } from 'lodash-es';
import { Readable } from 'node:stream';

export class ImporterStream extends Readable {
  private start: EpochTimeStamp;
  private end: EpochTimeStamp;
  private heart: Heart;
  private broker: Broker;
  private isLocked: boolean;

  constructor() {
    super({ objectMode: true });
    const { daterange, tickrate } = config.getWatch();

    this.start = toTimestamp(daterange.start);
    this.end = toTimestamp(daterange.end);
    this.heart = new Heart(tickrate ?? 1);
    this.broker = inject.broker();
    this.isLocked = false;

    bindAll(this, ['pushCandles', 'pushCandle', 'onTick']);

    logger.info(
      [
        `Importing data from ${toISOString(this.start)}`,
        `to ${toISOString(this.end)}`,
        `(${formatDuration(intervalToDuration({ start: this.start, end: this.end }))})`,
      ].join(' '),
    );

    this.heart.on('tick', this.onTick);
    this.heart.pump();
  }

  async onTick() {
    if (this.isLocked) return;
    this.isLocked = true;
    const candles = await this.broker.fetchOHLCV(this.start);
    if (!candles?.length) throw new ImporterError('No candle data was fetched.');
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
    this.push(candle);
  }
}
