import { GekkoError } from '@errors/gekko.error';
import { toISOString } from '@utils/date/date.utils';
import { Interval } from 'date-fns';

export class MissingCandlesError extends GekkoError {
  constructor({ start, end }: Interval<EpochTimeStamp, EpochTimeStamp>) {
    const message = [
      'Some candles are missing for the selected daterange',
      `(${toISOString(start)} -> ${toISOString(end)}) in database`,
    ];
    super('stream', message.join(' '));
    this.name = 'MissingCandlesError';
  }
}
