import { ONE_MINUTE } from '@constants/time.const';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { Transform, TransformCallback } from 'node:stream';

export type FillCandleGapOptions = {
  /**
   * Drop the leading buckets until every pair has had a candle, instead of pushing them without the pairs never seen so far.
   * The realtime pipeline needs it (the TradingAdvisor batcher refuses an incomplete bucket); the importer does not (each pair
   * is stored on its own, so its leading minutes are worth keeping).
   */
  dropIncompleteLeadingBuckets?: boolean;
};

export class FillCandleGapStream extends Transform {
  private readonly pairs: TradingPair[];
  private readonly dropIncompleteLeadingBuckets: boolean;
  private lastKnownCandles = new Map<TradingPair, Candle>();
  private lastTimestamp: number | null = null;
  private droppedLeadingMinutes = 0;

  constructor(pairs: TradingPair[], options: FillCandleGapOptions = {}) {
    super({ objectMode: true });
    this.pairs = pairs;
    this.dropIncompleteLeadingBuckets = options.dropIncompleteLeadingBuckets ?? false;
  }

  async _transform(bucket: CandleBucket, _: BufferEncoding, next: TransformCallback) {
    try {
      // 1. Determine current timestamp from any available candle in the bucket
      const firstCandle = bucket.values().next().value;
      if (!firstCandle) return next();

      const currentTimestamp = firstCandle.start;

      // 2. Drop the leading buckets that miss a pair never seen so far, if asked to
      if (this.dropIncompleteLeadingBuckets && this.isIncompleteLeadingBucket(bucket, currentTimestamp)) return next();

      // 3. Handle Total Gaps (Time jumps). Once a bucket has been pushed with dropIncompleteLeadingBuckets, every pair has a
      // last known candle, so a synthetic bucket is always complete.
      if (this.lastTimestamp !== null) {
        const expectedTimestamp = this.lastTimestamp + ONE_MINUTE;
        if (currentTimestamp > expectedTimestamp) {
          const gapMinutes = (currentTimestamp - expectedTimestamp) / ONE_MINUTE;
          warning('stream', `Total gap detected: filling ${gapMinutes} minute(s) for all assets from ${toISOString(expectedTimestamp)}`);

          let fillTimestamp = expectedTimestamp;
          while (fillTimestamp < currentTimestamp) {
            const filledBucket: CandleBucket = new Map();

            for (const pair of this.pairs) {
              const lastCandle = this.lastKnownCandles.get(pair);
              if (lastCandle) {
                const syntheticCandle = createEmptyCandle(lastCandle);
                syntheticCandle.start = fillTimestamp;

                filledBucket.set(pair, syntheticCandle);
                this.lastKnownCandles.set(pair, syntheticCandle);
              }
            }

            if (filledBucket.size > 0) {
              this.push(filledBucket);
            }
            fillTimestamp += ONE_MINUTE;
          }
        }
      }

      // 4. Process Current Bucket (Handle Partial Gaps)
      const completeBucket: CandleBucket = new Map();
      for (const pair of this.pairs) {
        const candle = bucket.get(pair);

        if (candle) {
          this.lastKnownCandles.set(pair, candle);
          completeBucket.set(pair, candle);
        } else {
          const lastCandle = this.lastKnownCandles.get(pair);
          if (lastCandle) {
            warning('stream', `Partial gap detected for ${pair} at ${toISOString(currentTimestamp)}: filling with empty candle`);
            const syntheticCandle = createEmptyCandle(lastCandle);
            syntheticCandle.start = currentTimestamp;

            this.lastKnownCandles.set(pair, syntheticCandle);
            completeBucket.set(pair, syntheticCandle);
          }
        }
      }

      this.lastTimestamp = currentTimestamp;
      this.push(completeBucket);
      next();
    } catch (error) {
      next(error as Error);
    }
  }

  /**
   * Tells whether a bucket misses a pair that has never had a candle. Such a bucket can only come before the first pushed one,
   * since every pair has a last known candle from then on. The candles it does hold still count as seen, so a pair seen in a
   * dropped bucket can be filled later on.
   */
  private isIncompleteLeadingBucket(bucket: CandleBucket, timestamp: EpochTimeStamp) {
    const neverSeenPairs = this.pairs.filter(pair => !bucket.has(pair) && !this.lastKnownCandles.has(pair));

    if (neverSeenPairs.length) {
      if (this.droppedLeadingMinutes === 0) {
        for (const pair of neverSeenPairs) {
          warning('stream', `No ${pair} candle at ${toISOString(timestamp)}: dropping the leading buckets until every pair has a candle`);
        }
      }
      for (const pair of this.pairs) {
        const candle = bucket.get(pair);
        if (candle) this.lastKnownCandles.set(pair, candle);
      }
      this.droppedLeadingMinutes++;
      return true;
    }

    if (this.droppedLeadingMinutes > 0) {
      warning(
        'stream',
        [
          `Every pair has had a candle by ${toISOString(timestamp)}, the first minute pushed:`,
          `${this.droppedLeadingMinutes} leading minute(s) dropped, so the warmup will end later than planned`,
        ].join(' '),
      );
      this.droppedLeadingMinutes = 0;
    }
    return false;
  }
}
