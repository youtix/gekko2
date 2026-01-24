import { TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { inject } from '@services/injecter/injecter';
import { debug, info, warning } from '@services/logger';
import { Storage } from '@services/storage/storage';
import { splitIntervals, toISOString } from '@utils/date/date.utils';
import { differenceInMinutes, Interval } from 'date-fns';
import { Readable } from 'node:stream';
import { MissingCandlesError } from './backtest.error';

interface BacktestStreamParams {
  daterange: Interval<EpochTimeStamp, EpochTimeStamp>;
  symbol: TradingPair;
}

export class BacktestStream extends Readable {
  private storage: Storage;
  private dateranges: Interval<EpochTimeStamp, EpochTimeStamp>[];
  private iteration: number;
  private symbol: TradingPair;

  constructor({ daterange, symbol }: BacktestStreamParams) {
    super({ objectMode: true });
    this.storage = inject.storage();

    warning('stream', 'BACKTESTING FEATURE NEEDS PROPER TESTING, ACT ON THESE NUMBERS AT YOUR OWN RISK!');

    const { batchSize } = config.getWatch();
    const strategy = config.getStrategy();
    this.dateranges = splitIntervals(daterange.start, daterange.end, batchSize ?? 1440);
    this.iteration = 0;
    this.symbol = symbol;

    info(
      'stream',
      [
        `Launching backtest on ${symbol}`,
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
      const candles = this.storage.getCandles(this.symbol, daterange);
      const expectedCandles = differenceInMinutes(daterange.end, daterange.start) + 1;
      if (candles.length === expectedCandles) candles.forEach(candle => this.push({ symbol: this.symbol, candle }));
      else throw new MissingCandlesError(this.symbol, daterange);

      debug('stream', `Reading database data from ${toISOString(daterange.start)} -> to ${toISOString(daterange.end)}`);
    }

    this.iteration++;
  }
}
