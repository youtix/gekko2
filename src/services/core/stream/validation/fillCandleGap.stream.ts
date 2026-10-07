import { ONE_MINUTE } from '@constants/time.const';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { debug, warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
import { pluralize } from '@utils/string/string.utils';
import { Transform, TransformCallback } from 'node:stream';

type FillCandleGapOptions = {
  /**
   * Whether only complete buckets go out. A pair missing from a bucket is filled from its last candle, which a pair that has had none
   * yet lacks. Without the option, the bucket goes out without that pair: the importer stores what it has, and a pair listed after the
   * start of its range has no candle there. With it, the bucket is dropped until every pair has had a candle: the realtime plugins
   * need every pair in every bucket (the TradingAdvisor throws otherwise), and a later candle cannot fill an earlier minute.
   */
  completeBucketsOnly?: boolean;
};

export class FillCandleGapStream extends Transform {
  private readonly pairs: TradingPair[];
  private readonly completeBucketsOnly: boolean;
  private lastKnownCandles = new Map<TradingPair, Candle>();
  private lastTimestamp: number | null = null;
  /** The buckets dropped so far for want of a candle of the pairs named (see completeBucketsOnly), until the stream starts */
  private dropped?: { count: number; first: EpochTimeStamp; last: EpochTimeStamp; pairs: Set<TradingPair> };

  constructor(pairs: TradingPair[], { completeBucketsOnly = false }: FillCandleGapOptions = {}) {
    super({ objectMode: true });
    this.pairs = pairs;
    this.completeBucketsOnly = completeBucketsOnly;
  }

  async _transform(bucket: CandleBucket, _: BufferEncoding, next: TransformCallback) {
    try {
      // 1. Determine current timestamp from any available candle in the bucket
      const firstCandle = bucket.values().next().value;
      if (!firstCandle) return next();

      const currentTimestamp = firstCandle.start;

      // Dropped before anything is recorded: the first bucket that goes out starts the stream, with no gap to fill before it
      if (this.completeBucketsOnly) {
        const unfillablePairs = this.pairs.filter(pair => !bucket.has(pair) && !this.lastKnownCandles.has(pair));
        if (unfillablePairs.length) {
          this.recordDrop(currentTimestamp, unfillablePairs);
          return next();
        }
        this.reportDrops(currentTimestamp);
      }

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

  /**
   * Only the first drop is a warning, the next ones are debug lines, summed up in one warning once the stream starts (reportDrops). A
   * pair listed during a long warmup window has no candle in thousands of its minutes: a warning each would flood the log, and evict
   * the other warnings from the buffer that Supervision forwards to Telegram.
   */
  private recordDrop(minute: EpochTimeStamp, unfillablePairs: TradingPair[]) {
    const reason = `No ${unfillablePairs.join(', ')} candle at ${toISOString(minute)}, nor an earlier one to fill it with`;
    if (this.dropped) debug('stream', `${reason}: bucket dropped`);
    else {
      warning('stream', `${reason}: the buckets are dropped until every pair has had a candle`);
      this.dropped = { count: 0, first: minute, last: minute, pairs: new Set() };
    }
    this.dropped.count++;
    this.dropped.last = minute;
    for (const pair of unfillablePairs) this.dropped.pairs.add(pair);
  }

  /** Sums the drops up when the first bucket goes out, which every pair has had a candle for: the stream starts with it */
  private reportDrops(start: EpochTimeStamp) {
    if (!this.dropped) return;
    const { count, first, last, pairs } = this.dropped;
    const waitedFor = this.pairs.filter(pair => pairs.has(pair)).join(', ');
    warning(
      'stream',
      [
        `${count} ${pluralize('bucket', count)} dropped from ${toISOString(first)} to ${toISOString(last)},`,
        `for want of a candle of ${waitedFor}: the stream starts at ${toISOString(start)}`,
      ].join(' '),
    );
    this.dropped = undefined;
  }
}
