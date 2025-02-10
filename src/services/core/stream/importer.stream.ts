import { ImporterError } from '@errors/importer.error';
import { config } from '@services/configuration/configuration';
import { formatDuration, intervalToDuration, isAfter, isBefore } from 'date-fns';
import { bindAll, each, filter, last } from 'lodash-es';
import { Readable } from 'node:stream';
import { Candle } from '../../../models/types/candle.types';
import { toISOString, toTimestamp } from '../../../utils/date/date.utils';
import { logger } from '../../logger';
import { Heart } from '../heart/heart';
import { CandleProvider } from '../provider/candleProvider/candleProvider';

export class ImporterStream extends Readable {
  start: EpochTimeStamp;
  end: EpochTimeStamp;
  heart: Heart;
  provider: CandleProvider;

  constructor() {
    super({ objectMode: true });
    const { daterange } = config.getWatch();

    this.start = toTimestamp(daterange.start);
    this.end = toTimestamp(daterange.end);
    this.heart = new Heart(1);
    this.provider = new CandleProvider();

    bindAll(this, ['pushCandles', 'pushCandle', 'onTick']);

    logger.debug(
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
    const candles = await this.provider.fetch(this.start);
    if (!candles?.length) throw new ImporterError('0 candle has been fetched !');
    this.start = last(candles)?.start ?? Number.MAX_SAFE_INTEGER;
    this.start++;
    if (!isBefore(this.start, this.end)) {
      this.pushCandles(filter(candles, (candle) => !isAfter(candle.start, this.end)));
      this.push(null);
      this.heart.stop();
    } else {
      this.pushCandles(candles);
    }
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
