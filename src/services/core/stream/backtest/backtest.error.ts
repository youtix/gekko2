import { GekkoError } from '@errors/gekko.error';
import { Nullable } from '@models/utility.types';
import { CandleDateranges } from '@services/storage/storage.types';
import { toISOString } from '@utils/date/date.utils';
import { Interval } from 'date-fns';

/** Candle counts of a batch read during the backtest, when the read finds fewer candles than the date range check did */
export type BatchCandleCount = { expected: number; received: number };

export class MissingCandlesError extends GekkoError {
  constructor(
    symbol: string,
    { start, end }: Interval<EpochTimeStamp, EpochTimeStamp>,
    availableDateRanges: Nullable<CandleDateranges[]> = [],
    batch?: BatchCandleCount,
  ) {
    const availableRangesMessage = availableDateRanges?.length
      ? availableDateRanges
          .map(({ daterange_start, daterange_end }) => `[${toISOString(daterange_start)} - ${toISOString(daterange_end)}]`)
          .join(', ')
      : 'No date ranges found in database';
    const rangeMessage = batch
      ? [
          `${symbol} batch ${toISOString(start)} -> ${toISOString(end)}: expected ${batch.expected} candles, received ${batch.received}`,
          '(the database may have changed since the date range was checked),',
        ]
      : [`${symbol} ${toISOString(start)} -> ${toISOString(end)},`];
    const message = ['Missing candles in database:', ...rangeMessage, 'Available date ranges:', availableRangesMessage];
    super('stream', message.join(' '));
    this.name = 'MissingCandlesError';
  }
}
