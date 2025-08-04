import { Batch } from '@models/types/batch.types';
import { Candle } from '@models/types/candle.types';
import { Trade } from '@models/types/trade.types';
import { debug } from '@services/logger';
import { resetDateParts, toISOString } from '@utils/date/date.utils';
import { addPrecise } from '@utils/math/math.utils';
import { pluralize } from '@utils/string/string.utils';
import { dropRight, each, first, groupBy, last, map, max, mergeWith, min, pick, sortBy } from 'lodash-es';

export class CandleManager {
  lastMinuteTrades: Record<string, Trade[]> = {};

  public processBacth(batch: Batch): Candle[] {
    const trades = batch.data;

    const buckets = mergeWith(
      groupBy(trades, trade => toISOString(resetDateParts(trade.timestamp, ['ms', 's']))),
      this.lastMinuteTrades,
      (objValue, srcValue) => srcValue?.concat(objValue ?? []),
    );

    const lastTrade = last(trades);
    this.lastMinuteTrades = lastTrade
      ? pick(buckets, [toISOString(resetDateParts(lastTrade.timestamp, ['ms', 's']))])
      : {};

    const candles = sortBy(map(buckets, this.calculateCandle), 'start');
    if (!candles?.length) return [];

    if (candles && candles.length - 1) {
      const count = candles.length - 1;
      debug('core', `${count} ${pluralize('candle', count)} (1 min) created from trades.`);
    }

    return dropRight(candles);
  }

  private calculateCandle(trades: Trade[]): Candle {
    const firstTrade = first(trades);
    const lastTrade = last(trades);

    const firstTradePrice = firstTrade?.price ?? 0;
    const lastTradePrice = lastTrade?.price ?? 0;

    const candle: Candle = {
      start: resetDateParts(firstTrade?.timestamp ?? 0, ['ms', 's']),
      open: firstTradePrice,
      high: firstTradePrice,
      low: firstTradePrice,
      close: lastTradePrice,
      volume: 0,
    };

    each(trades, ({ price, amount }) => {
      candle.high = max([candle.high, price]) ?? 0;
      candle.low = min([candle.low, price]) ?? 0;
      // Use exact precision to guarantee accurate comparisons during monitoring (supervision plugin)
      candle.volume = addPrecise(candle.volume, amount);
    });

    return candle;
  }
}
