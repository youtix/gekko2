import { ONE_MINUTE } from '@constants/time.const';
import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { Transform, TransformCallback } from 'node:stream';

export class FillCandleGapStream extends Transform {
  private lastBucket: CandleBucket | null = null;

  constructor() {
    super({ objectMode: true });
  }

  async _transform(bucket: CandleBucket, _: BufferEncoding, next: TransformCallback) {
    try {
      if (!this.lastBucket) {
        this.lastBucket = bucket;
        this.push(bucket);
        return next();
      }

      // Get expected next timestamp from any symbol in last bucket
      const lastCandle = this.lastBucket.values().next().value;
      if (!lastCandle) return next();

      const expectedTimestamp = lastCandle.start + ONE_MINUTE;
      const currentCandle = bucket.values().next().value;
      if (!currentCandle) return next();

      const currentTimestamp = currentCandle.start;

      // Fill gaps if needed
      if (currentTimestamp > expectedTimestamp) {
        warning('stream', `Gap detected: filling ${(currentTimestamp - expectedTimestamp) / ONE_MINUTE} minute(s)`);

        let fillTimestamp = expectedTimestamp;
        while (fillTimestamp < currentTimestamp) {
          const filledBucket: CandleBucket = new Map();
          for (const [symbol, candle] of this.lastBucket) {
            filledBucket.set(symbol, createEmptyCandle({ ...candle, start: fillTimestamp - ONE_MINUTE }));
          }
          this.push(filledBucket);
          this.lastBucket = filledBucket;
          fillTimestamp += ONE_MINUTE;
        }
      }

      this.lastBucket = bucket;
      this.push(bucket);
      next();
    } catch (error) {
      next(error as Error);
    }
  }
}
