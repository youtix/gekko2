import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { CandleSize } from './candleBatcher.types';
import { FastCandleBatcher } from './fastCandleBatcher';

/**
 * Batches 1-minute CandleBuckets into higher timeframe CandleBuckets.
 * Emits a completed bucket only when ALL pairs have reached the timeframe boundary.
 */
export class CandleBucketBatcher {
  private readonly batchers: Map<TradingPair, FastCandleBatcher>;
  private readonly pairs: ReadonlySet<TradingPair>;
  private pendingBucket: Map<TradingPair, Candle>;

  constructor(pairs: TradingPair[], candleSize: CandleSize) {
    this.pairs = new Set(pairs);
    this.batchers = new Map(pairs.map(pair => [pair, new FastCandleBatcher(candleSize)]));
    this.pendingBucket = new Map();
  }

  /**
   * Process a 1-minute candle bucket.
   * @param bucket - Must contain candles for ALL registered pairs
   * @returns Completed timeframe bucket, or undefined if not yet ready
   * @throws Error if bucket is missing any registered pair
   */
  addBucket(bucket: CandleBucket): CandleBucket | undefined {
    // Validate bucket completeness (fail fast)
    for (const pair of this.pairs) {
      if (!bucket.has(pair)) {
        // Upstream MUST guarantee strict completeness of the bucket, that's why we throw here
        throw new Error(`CandleBucketBatcher: Missing candle for pair "${pair}". ` + `Expected pairs: [${[...this.pairs].join(', ')}]`);
      }
    }

    // Process each pair
    let allReady = true;
    for (const [pair, candle] of bucket) {
      if (!this.pairs.has(pair)) continue; // Ignore unregistered pairs

      const batcher = this.batchers.get(pair)!;
      const completedCandle = batcher.addCandle(candle);

      if (completedCandle) {
        this.pendingBucket.set(pair, completedCandle);
      } else {
        allReady = false;
      }
    }

    // Emit only when all pairs are ready
    if (allReady && this.pendingBucket.size === this.pairs.size) {
      const result = this.pendingBucket;
      this.pendingBucket = new Map();
      return result;
    }

    return undefined;
  }

  /**
   * Get the number of registered trading pairs.
   */
  get pairCount(): number {
    return this.pairs.size;
  }
}
