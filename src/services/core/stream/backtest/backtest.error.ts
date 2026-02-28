import { GekkoError } from '@errors/gekko.error';
import { Nullable } from '@models/utility.types';
import { CandleDateranges } from '@services/storage/storage.types';
import { toISOString } from '@utils/date/date.utils';
import { Interval } from 'date-fns';

export class MissingCandlesError extends GekkoError {
  constructor(
    symbol: string,
    { start, end }: Interval<EpochTimeStamp, EpochTimeStamp>,
    availableDateRanges: Nullable<CandleDateranges[]> = [],
  ) {
    const availableRangesMessage = availableDateRanges?.length
      ? availableDateRanges
          .map(({ daterange_start, daterange_end }) => `[${toISOString(daterange_start)} - ${toISOString(daterange_end)}]`)
          .join(', ')
      : 'No date ranges found in database';

    const message = [
      'Missing candles in database:',
      `${symbol} ${toISOString(start)} -> ${toISOString(end)},`,
      'Available date ranges:',
      availableRangesMessage,
    ];

    super('stream', message.join(' '));
    this.name = 'MissingCandlesError';
  }
}
