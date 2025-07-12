import { Batch } from '@models/types/batch.types';
import { Trade } from '@models/types/trade.types';
import { debug, warning } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { pluralize } from '@utils/string/string.utils';
import { filterTradesByTimestamp } from '@utils/trade/trade.utils';
import { formatDuration, intervalToDuration, subMilliseconds } from 'date-fns';
import { filter, first, last } from 'lodash-es';

export class TradeBatcher {
  threshold: EpochTimeStamp;

  constructor(threshold?: number) {
    this.threshold = threshold ? subMilliseconds(resetDateParts(threshold, ['s', 'ms']), 1).getTime() : 0;
  }

  processTrades(trades: Trade[]) {
    const filteredTrades = filter(filterTradesByTimestamp(trades, this.threshold), 'amount');
    if (filteredTrades.length !== trades.length) {
      const count = trades.length - filteredTrades.length;
      debug('core', `Filtered ${count} ${pluralize('trade', count)}`);
    } else if (this.threshold) warning('core', 'No trade filtred, probably missing trades !');

    const firstTrade = first(filteredTrades);
    const lastTrade = last(filteredTrades);

    if (!firstTrade?.timestamp || !lastTrade?.timestamp) return warning('core', 'No new trades !');

    debug(
      'core',
      [
        `Processing ${filteredTrades.length} new trades.`,
        `From ${toISOString(firstTrade.timestamp)}`,
        `to ${toISOString(lastTrade.timestamp)}`,
        `(${formatDuration(intervalToDuration({ start: firstTrade.timestamp, end: lastTrade.timestamp }))})`,
      ].join(' '),
    );

    const batch: Batch = {
      amount: filteredTrades.length,
      start: firstTrade.timestamp,
      end: lastTrade.timestamp,
      last: lastTrade,
      first: firstTrade,
      data: filteredTrades,
    };

    this.threshold = lastTrade.timestamp;

    return batch;
  }
}
