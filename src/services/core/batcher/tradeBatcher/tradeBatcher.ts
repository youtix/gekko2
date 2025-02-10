import { formatDuration, intervalToDuration } from 'date-fns';
import { filter, first, last } from 'lodash-es';
import { Batch } from '../../../../models/types/batch.types';
import { Trade } from '../../../../models/types/trade.types';
import { toISOString } from '../../../../utils/date/date.utils';
import { filterTradesByTimestamp } from '../../../../utils/trade/trade.utils';
import { logger } from '../../../logger';

export class TradeBatcher {
  threshold: EpochTimeStamp;

  constructor() {
    this.threshold = 0;
  }

  processTrades(trades: Trade[]) {
    const filteredTrades = filter(filterTradesByTimestamp(trades, this.threshold), 'amount');
    if (filteredTrades.length !== trades.length)
      logger.debug(`Filtered ${trades.length - filteredTrades.length} trade(s)`);
    else if (this.threshold) logger.warn('No trade filtred, probably missing trades !');

    const firstTrade = first(filteredTrades);
    const lastTrade = last(filteredTrades);

    if (!firstTrade?.timestamp || !lastTrade?.timestamp) {
      logger.warn('No new trades !');
      return;
    }

    logger.debug(
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
