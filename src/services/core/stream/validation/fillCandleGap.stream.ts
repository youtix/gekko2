import { ONE_MINUTE } from '@constants/time.const';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { Transform, TransformCallback } from 'node:stream';

export class FillCandleGapStream extends Transform {
  private readonly pairs: TradingPair[];
  private lastKnownCandles = new Map<TradingPair, Candle>();
  private lastTimestamp: number | null = null;

  constructor(pairs: TradingPair[]) {
    super({ objectMode: true });
    this.pairs = pairs;
  }

  async _transform(bucket: CandleBucket, _: BufferEncoding, next: TransformCallback) {
    try {
      // 1. Determine current timestamp from any available candle in the bucket
      const firstCandle = bucket.values().next().value;
      if (!firstCandle) return next();

      const currentTimestamp = firstCandle.start;

      // 2. Handle Total Gaps (Time jumps)
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

      // 3. Process Current Bucket (Handle Partial Gaps)
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
}
