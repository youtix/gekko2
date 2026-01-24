import { Candle } from '@models/candle.types';
import { CandleEvent } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { differenceInMinutes } from 'date-fns';
import { Transform, TransformCallback } from 'node:stream';

export class RejectDuplicateCandleStream extends Transform {
  private lastCandle: Record<TradingPair, Candle> = {};

  constructor() {
    super({ objectMode: true });
  }

  async _transform({ symbol, candle }: CandleEvent, _: BufferEncoding, next: TransformCallback) {
    if (!candle) return next(null, { symbol, candle });

    try {
      const lastCandle = this.lastCandle[symbol];

      if (!lastCandle) {
        this.lastCandle[symbol] = candle;
        return next(null, { symbol, candle });
      }

      const isCandleAlreadyProcessed = differenceInMinutes(candle.start, lastCandle.start) < 1;
      if (isCandleAlreadyProcessed) {
        warning(
          'stream',
          [
            'Duplicate candle detected ! Ignoring it !',
            `Current candle being processed: ${toISOString(candle.start)}`,
            `Last candle processed ${toISOString(lastCandle.start)}.`,
          ].join(' '),
        );
        return next();
      }
      this.push({ symbol, candle });
      this.lastCandle[symbol] = candle;

      next();
    } catch (error) {
      next(error as Error);
    }
  }
}
