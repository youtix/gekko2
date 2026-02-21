import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { differenceInMinutes } from 'date-fns';
import { isNil } from 'lodash-es';
import { Transform, TransformCallback } from 'node:stream';

export class RejectDuplicateCandleStream extends Transform {
  private lastBucketTimestamp?: EpochTimeStamp;

  constructor() {
    super({ objectMode: true });
  }

  async _transform(bucket: CandleBucket, _: BufferEncoding, next: TransformCallback) {
    try {
      const firstCandle = bucket.values().next().value;
      if (!firstCandle) return next();

      const bucketTimestamp = firstCandle.start;

      if (!isNil(this.lastBucketTimestamp)) {
        const isBucketDuplicate = differenceInMinutes(bucketTimestamp, this.lastBucketTimestamp) < 1;
        if (isBucketDuplicate) {
          warning('stream', `Duplicate bucket detected @ ${toISOString(bucketTimestamp)}. Ignoring.`);
          return next();
        }
      }

      this.lastBucketTimestamp = bucketTimestamp;
      this.push(bucket);
      next();
    } catch (error) {
      next(error as Error);
    }
  }
}
