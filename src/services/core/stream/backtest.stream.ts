import { MissingCandlesError } from '@errors/backtest/MissingCandles.error';
import { config } from '@services/configuration/configuration';
import { logger } from '@services/logger';
import { inject } from '@services/storage/injecter';
import { Storage } from '@services/storage/storage';
import { splitIntervals, toISOString } from '@utils/date/date.utils';
import { differenceInMinutes, Interval } from 'date-fns';
import { Readable } from 'node:stream';

export class BacktestStream extends Readable {
  private storage: Storage;
  private dateranges: Interval<EpochTimeStamp, EpochTimeStamp>[];
  private iteration: number;

  constructor(daterange: Interval<EpochTimeStamp, EpochTimeStamp>) {
    super({ objectMode: true });
    this.storage = inject.storage();

    const result = this.storage.checkInterval(daterange);
    if (result?.missingCandleCount) {
      const availableDateranges = this.storage.getCandleDateranges();
      // eslint-disable-next-line no-console
      console.table(availableDateranges);
      throw new MissingCandlesError(daterange);
    }

    logger.warn('WARNING: BACKTESTING FEATURE NEEDS PROPER TESTING');
    logger.warn('WARNING: ACT ON THESE NUMBERS AT YOUR OWN RISK!');

    const { batchSize, asset, currency } = config.getWatch();
    const { name } = config.getStrategy();
    this.dateranges = splitIntervals(daterange.start, daterange.end, batchSize ?? 1440);
    this.iteration = 0;

    logger.info(
      [
        `Launching backtest on ${asset}/${currency}`,
        `from ${toISOString(daterange.start)} -> to ${toISOString(daterange.end)}`,
        `using ${name} strategy`,
      ].join(' '),
    );
  }

  public _read() {
    if (this.iteration >= this.dateranges.length) {
      this.push(null);
      return;
    }

    const daterange = this.dateranges[this.iteration];

    if (daterange) {
      const candles = this.storage.getCandles(daterange);
      const expectedCandles = differenceInMinutes(daterange.end, daterange.start) + 1;
      if (candles.length === expectedCandles) candles.forEach(candle => this.push(candle));
      else throw new MissingCandlesError(daterange);

      logger.debug(`Reading database data from ${toISOString(daterange.start)} -> to ${toISOString(daterange.end)}`);
    }

    this.iteration++;
  }
}
