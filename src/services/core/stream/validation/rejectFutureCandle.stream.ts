import { ONE_MINUTE } from '@constants/time.const';
import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { Transform, TransformCallback } from 'node:stream';

export class RejectFutureCandleStream extends Transform {
  constructor() {
    super({ objectMode: true });
  }

  async _transform(bucket: CandleBucket, _: BufferEncoding, next: TransformCallback) {
    try {
      // All candles in the bucket share the same timestamp, check any one
      const firstCandle = bucket.values().next().value;
      if (!firstCandle) return next();

      const candleEndTime = firstCandle.start + ONE_MINUTE;
      if (candleEndTime > Date.now()) {
        warning('stream', `Rejecting future bucket: candle end time ${toISOString(candleEndTime)} is in the future.`);
        return next();
      }

      this.push(bucket);
      next();
    } catch (error) {
      next(error as Error);
    }
  }
}
