import { Candle } from '@models/candle.types';
import { CandleEvent } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { differenceInMinutes } from 'date-fns';
import { Transform, TransformCallback } from 'node:stream';

export class RejectDuplicateCandleStream extends Transform {
  private lastCandle?: Record<TradingPair, Candle>;

  constructor() {
    super({ objectMode: true });
  }

  async _transform({ symbol, candle }: CandleEvent, _: BufferEncoding, next: TransformCallback) {
    const lastCandle = this.lastCandle?.[symbol];
    if (!candle || !lastCandle) return next(null, { symbol, candle });

    try {
      const isCandleAlreadyProceed = differenceInMinutes(candle.start, lastCandle.start) < 1;
      if (isCandleAlreadyProceed) {
        warning(
          'stream',
          [
            'Duplicate candle detected ! Ignoring it !',
            `Current candle being proceed: ${toISOString(candle.start)}`,
            `Last candle proceed ${toISOString(lastCandle.start)}.`,
          ].join(' '),
        );
        return next();
      }
      this.push({ symbol, candle });
      this.lastCandle = { ...lastCandle, [symbol]: candle };

      next();
    } catch (error) {
      next(error as Error);
    }
  }
}
