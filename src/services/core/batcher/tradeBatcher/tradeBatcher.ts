import { Batch } from '@models/types/batch.types';
import { Trade } from '@models/types/trade.types';
import { debug, warning } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { processStartTime } from '@utils/process/process.utils';
import { pluralize } from '@utils/string/string.utils';
import { filterTradesByTimestamp } from '@utils/trade/trade.utils';
import { formatDuration, intervalToDuration } from 'date-fns';
import { differenceBy, first, last } from 'lodash-es';

export class TradeBatcher {
  private processStartDate: EpochTimeStamp;
  private lastTrades: Trade[];

  constructor() {
    this.lastTrades = [];
    this.processStartDate = resetDateParts(processStartTime(), ['s', 'ms']);
  }

  processTrades(trades: Trade[]) {
    const filteredTrades = filterTradesByTimestamp(differenceBy(trades, this.lastTrades, 'id'), this.processStartDate);

    const count = trades.length - filteredTrades.length;
    if (count > 0) debug('core', `Filtered out ${count} ${pluralize('trade', count)}`);
    else {
      warning(
        'core',
        [
          '⚠️ Trade filtering warning:',
          'No trades were filtered — this may indicate a data gap or missing trades due to high market activity.',
          `Last known trade before gap: ${last(this.lastTrades)?.id ?? 'N/A'}.`,
          `First trade processed after gap: ${first(filteredTrades)?.id ?? 'N/A'}.`,
        ].join(' '),
      );
    }

    const firstTrade = first(filteredTrades);
    const lastTrade = last(filteredTrades);

    if (!firstTrade || !lastTrade) return debug('core', 'No new trades to process possibly due to low market activity');

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

    this.lastTrades = trades;

    return batch;
  }
}
