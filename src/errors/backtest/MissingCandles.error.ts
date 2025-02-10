import { toISOString } from '@utils/date/date.utils';
import { Interval } from 'date-fns';
import { BacktestError } from './backtest.error';

export class MissingCandlesError extends BacktestError {
  constructor({ start, end }: Interval<EpochTimeStamp, EpochTimeStamp>) {
    const message = [
      'Some candles are missing for the selected daterange',
      `(${toISOString(start)} -> ${toISOString(end)}) in database`,
    ];
    super(message.join(' '));
    this.name = 'MissingCandlesError';
  }
}
