import { ONE_MINUTE } from '@constants/time.const';
import { CandleEvent } from '@models/event.types';
import { warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { Transform, TransformCallback } from 'node:stream';

export class RejectFutureCandleStream extends Transform {
  constructor() {
    super({ objectMode: true });
  }

  async _transform({ symbol, candle }: CandleEvent, _: BufferEncoding, next: TransformCallback) {
    if (!candle) return next(null, { symbol, candle });
    try {
      const candleEndTime = candle.start + ONE_MINUTE;
      if (candleEndTime > Date.now()) {
        warning(
          'stream',
          `Rejecting future candle: candle end time ${toISOString(candleEndTime)} is in the future. Current time: ${toISOString(Date.now())}.`,
        );
        return next();
      }

      this.push({ symbol, candle });
      next();
    } catch (error) {
      next(error as Error);
    }
  }
}
