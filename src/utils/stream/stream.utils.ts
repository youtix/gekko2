import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { Readable } from 'node:stream';

type TradingPairCandle = { symbol: TradingPair; candle: Candle };

/**
 * Synchronizes multiple streams of CandleEvents by timestamp.
 * It waits for data from all active streams and emits CandleBuckets in strict chronological order.
 * For a given timestamp T, it aggregates all events at T into a single CandleBucket,
 * before moving to T+1.
 */
export const synchronizeStreams = (streams: Readable[]): Readable => {
  const iteratorMap = new Map<Readable, AsyncIterator<unknown>>();
  const bufferMap = new Map<Readable, TradingPairCandle | null>(); // null means stream ended
  const activeStreams = new Set(streams);

  // Initialize iterators
  for (const stream of streams) {
    iteratorMap.set(stream, stream[Symbol.asyncIterator]());
  }

  async function* generator() {
    try {
      while (true) {
        // 1. Ensure all active streams have a value in the buffer
        const pendingStreams: Readable[] = [];
        for (const stream of activeStreams) {
          if (!bufferMap.has(stream)) {
            pendingStreams.push(stream);
          }
        }

        if (pendingStreams.length > 0) {
          const promises = pendingStreams.map(async stream => {
            const iterator = iteratorMap.get(stream)!;
            const result = await iterator.next();
            if (result.done) {
              activeStreams.delete(stream);
              bufferMap.set(stream, null);
            } else {
              bufferMap.set(stream, result.value as TradingPairCandle);
            }
          });
          await Promise.all(promises);
        }

        // 2. Check if we have any data left to process
        // If all streams are done and buffers are consumed/null, we are finished.
        const hasValidBuffer = Array.from(bufferMap.values()).some(v => v !== null);
        if (activeStreams.size === 0 && !hasValidBuffer) {
          break;
        }

        // 3. Find minimum timestamp among all valid buffered items
        let minTimestamp = Infinity;

        for (const event of bufferMap.values()) {
          if (!event) continue;
          if (event.candle && event.candle.start < minTimestamp) {
            minTimestamp = event.candle.start;
          }
        }

        if (minTimestamp === Infinity) {
          break;
        }

        // 4. Aggregate all events at minTimestamp into a CandleBucket
        const bucket: CandleBucket = new Map();
        const streamsToClear: Readable[] = [];

        for (const [stream, event] of bufferMap) {
          if (event && event.candle && event.candle.start === minTimestamp) {
            bucket.set(event.symbol, event.candle);
            streamsToClear.push(stream);
          }
        }

        // 5. Yield the bucket and clear processed entries
        yield bucket;
        for (const stream of streamsToClear) {
          bufferMap.delete(stream);
        }

        // Safety check to prevent infinite loop if nothing was cleared
        if (streamsToClear.length === 0 && hasValidBuffer) {
          break;
        }
      }
    } finally {
      // Cleanup if needed
      for (const [stream] of iteratorMap) {
        if (!stream.destroyed) {
          // stream.destroy(); // Optional: destroy source streams?
        }
      }
    }
  }

  return Readable.from(generator());
};
