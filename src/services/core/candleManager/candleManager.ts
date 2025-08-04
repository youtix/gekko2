import { Batch } from '@models/types/batch.types';
import { Candle } from '@models/types/candle.types';
import { debug } from '@services/logger';
import { addPrecise } from '@utils/math/math.utils';
import { pluralize } from '@utils/string/string.utils';

export class CandleManager {
  private threshold: number = 0;
  private workingCandle: Candle | null = null;

  public processBatch(batch: Batch): Candle[] {
    const finished: Candle[] = [];

    for (const trade of batch.data) {
      if (trade.timestamp <= this.threshold) continue;

      const minuteStart = trade.timestamp - (trade.timestamp % 60_000);

      if (this.workingCandle && this.workingCandle.start !== minuteStart) {
        finished.push({ ...this.workingCandle });
        this.workingCandle = null;
      }

      if (!this.workingCandle) {
        this.workingCandle = {
          start: minuteStart,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.amount,
        };
        continue;
      }

      const c = this.workingCandle;
      if (trade.price > c.high) c.high = trade.price;
      if (trade.price < c.low) c.low = trade.price;
      c.close = trade.price;
      c.volume = addPrecise(c.volume, trade.amount);
    }

    if (finished.length) {
      const count = finished.length;
      debug('core', `${count} ${pluralize('candle', count)} (1 min) created from trades.`);
      this.threshold = finished[finished.length - 1].start;
    }

    return finished;
  }
}
