import { config } from '@services/configuration/configuration';
import { inject } from '@services/injecter/injecter';
import { debug, info, warning } from '@services/logger';
import { Storage } from '@services/storage/storage';
import { splitIntervals, toISOString } from '@utils/date/date.utils';
import { differenceInMinutes, Interval } from 'date-fns';
import { Readable } from 'node:stream';
import { MissingCandlesError } from './backtest.error';

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
      throw new MissingCandlesError(daterange, availableDateranges);
    }

    warning('stream', 'BACKTESTING FEATURE NEEDS PROPER TESTING, ACT ON THESE NUMBERS AT YOUR OWN RISK!');

    const { batchSize, pairs } = config.getWatch();
    const { symbol } = pairs[0]; // TODO: support multiple pairs
    const [asset, currency] = symbol.split('/');
    const strategy = config.getStrategy();
    this.dateranges = splitIntervals(daterange.start, daterange.end, batchSize ?? 1440);
    this.iteration = 0;

    info(
      'stream',
      [
        `Launching backtest on ${asset}/${currency}`,
        `from ${toISOString(daterange.start)} -> to ${toISOString(daterange.end)}`,
        `using ${strategy?.name} strategy`,
      ].join(' '),
    );
  }
  public _read(_size: number): void {
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

      debug('stream', `Reading database data from ${toISOString(daterange.start)} -> to ${toISOString(daterange.end)}`);
    }

    this.iteration++;
  }
}
