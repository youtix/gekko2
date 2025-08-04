import { Batch } from '@models/types/batch.types';
import { Trade } from '@models/types/trade.types';
import { debug, warning } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { processStartTime } from '@utils/process/process.utils';
import { pluralize } from '@utils/string/string.utils';
import { formatDuration, intervalToDuration } from 'date-fns';

export class TradeBatcher {
  private readonly processStartDate: EpochTimeStamp;
  private lastProcessedTs: EpochTimeStamp;
  private readonly seen: Set<Trade['id']> = new Set();

  constructor() {
    this.processStartDate = resetDateParts(processStartTime(), ['s', 'ms']);
    this.lastProcessedTs = this.processStartDate;
  }

  processTrades(trades: Trade[]): Batch | void {
    if (!trades.length) return debug('core', 'No trades received');

    const fresh: Trade[] = new Array(trades.length);
    let tradesToProcess = 0;

    for (let i = 0; i < trades.length; ++i) {
      const trade = trades[i];

      if (trade.timestamp <= this.lastProcessedTs || trade.timestamp < this.processStartDate) continue;

      if (this.seen.has(trade.id)) continue;

      if (this.seen.size > 65_536) {
        let pruned = 0;
        for (const id of this.seen) {
          this.seen.delete(id);
          if (++pruned > 32_768) break;
        }
      }

      this.seen.add(trade.id);
      fresh[tradesToProcess++] = trade;
    }

    if (tradesToProcess === 0) return debug('core', 'No new trades to process');

    const filteredTrades = fresh.slice(0, tradesToProcess);
    const firstTrade = filteredTrades[0];
    const lastTrade = filteredTrades[filteredTrades.length - 1];

    const skipped = trades.length - tradesToProcess;
    if (skipped > 0) {
      debug('core', `Filtered out ${skipped} ${pluralize('duplicate trade', skipped)}`);
    } else {
      warning(
        'core',
        [
          '⚠️ Trade filtering warning:',
          'No duplicates filtered — potential gap or burst of new trades.',
          `First fresh trade: ${firstTrade.id}.`,
          `Last fresh trade: ${lastTrade.id}.`,
        ].join(' '),
      );
    }

    debug(
      'core',
      [
        `Processing ${tradesToProcess} new trades.`,
        `From ${toISOString(firstTrade.timestamp)}`,
        `to ${toISOString(lastTrade.timestamp)}`,
        `(${formatDuration(intervalToDuration({ start: firstTrade.timestamp, end: lastTrade.timestamp }))})`,
      ].join(' '),
    );

    const batch: Batch = {
      amount: tradesToProcess,
      start: firstTrade.timestamp,
      end: lastTrade.timestamp,
      first: firstTrade,
      last: lastTrade,
      data: filteredTrades,
    };

    this.lastProcessedTs = lastTrade.timestamp;
    return batch;
  }
}
