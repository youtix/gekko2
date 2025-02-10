import Big from 'big.js';
import { addMinutes, differenceInMinutes, isBefore } from 'date-fns';
import {
  dropRight,
  each,
  filter,
  first,
  groupBy,
  last,
  map,
  max,
  mergeWith,
  min,
  pick,
  sortBy,
} from 'lodash-es';
import { Batch } from '../../../models/types/batch.types';
import { Candle } from '../../../models/types/candle.types';
import { Undefined } from '../../../models/types/generic.types';
import { Trade } from '../../../models/types/trade.types';
import { resetDateParts, toISOString } from '../../../utils/date/date.utils';
import { filterTradesByTimestamp } from '../../../utils/trade/trade.utils';
import { logger } from '../../logger';

export class CandleManager {
  threshold: EpochTimeStamp;
  lastMinuteTrades: { [key: string]: Trade[] } = {};

  constructor() {
    this.threshold = 0;
  }

  public processBacth(batch: Batch): Candle[] {
    const trades = filterTradesByTimestamp(batch.data, this.threshold);

    const buckets = mergeWith(
      groupBy(trades, trade => toISOString(resetDateParts(trade.timestamp, ['ms', 's']))),
      this.lastMinuteTrades,
      (objValue, srcValue) => srcValue?.concat(objValue ?? []),
    );

    const lastTrade = last(trades);
    this.lastMinuteTrades = lastTrade
      ? pick(buckets, [toISOString(resetDateParts(lastTrade.timestamp, ['ms', 's']))])
      : {};

    const candles = this.addEmptyCandles(sortBy(map(buckets, this.calculateCandle), 'start'));
    if (!candles?.length) return [];

    if (candles && candles.length - 1)
      logger.debug(`${candles.length - 1} candle(s) of 1 min created from trade(s)`);

    this.threshold = last(candles)?.start ?? 0;
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
      candle.volume = +Big(amount).plus(candle.volume);
    });

    return candle;
  }

  private addEmptyCandles(candles: Candle[]): Undefined<Candle[]> {
    const firstCandleStart = first(candles)?.start;
    const lastCandleStart = last(candles)?.start;

    if (!candles.length || !firstCandleStart || !lastCandleStart) return;

    const startDates = map(candles, c => c.start);
    const emptyArray = Array(differenceInMinutes(lastCandleStart, firstCandleStart) + 1).fill(
      undefined,
    );

    const allStartDates = map(emptyArray, (_, index) =>
      addMinutes(firstCandleStart, index).getTime(),
    );

    return map(allStartDates, startDate => {
      if (startDates.includes(startDate)) return candles[startDates.indexOf(startDate)];
      const lastCandle = last(filter(candles, c => isBefore(c.start, startDate)));
      const lastCandlePrice = lastCandle?.close ?? 0;
      return {
        start: startDate,
        open: lastCandlePrice,
        high: lastCandlePrice,
        low: lastCandlePrice,
        close: lastCandlePrice,
        volume: 0,
      };
    });
  }
}
