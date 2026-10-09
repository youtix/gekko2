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
  if (streams.length === 0) return Readable.from([]);

  let reading = false;
  let streamsEnded = 0;
  const numStreams = streams.length;
  const buffers: (TradingPairCandle | null)[] = new Array(numStreams).fill(null);
  const ended: boolean[] = new Array(numStreams).fill(false);

  const out = new Readable({
    objectMode: true,
    read() {
      reading = true;
      tryProcess();
    },
    destroy(err, cb) {
      for (const s of streams) {
        if (!s.destroyed) s.destroy(err || undefined);
      }
      cb(err);
    },
  });

  const tryProcess = () => {
    if (!reading) return;

    while (reading) {
      let needsWait = false;

      // 1. Ensure all active streams have a value in the buffer
      for (let i = 0; i < numStreams; i++) {
        if (!ended[i] && buffers[i] === null) {
          const chunk = streams[i].read() as TradingPairCandle | null;
          if (chunk !== null) {
            buffers[i] = chunk;
          } else {
            needsWait = true;
          }
        }
      }

      // 2. Check if we have any data left to process
      if (streamsEnded === numStreams && buffers.every(b => b === null)) {
        out.push(null);
        reading = false;
        return;
      }

      // If any active stream is starved and returned null on .read(), we must pause synchronous processing
      if (needsWait) {
        return;
      }

      // 3. Find minimum timestamp among all valid buffered items
      let minTimestamp = Infinity;
      for (let i = 0; i < numStreams; i++) {
        const buf = buffers[i];
        if (buf !== null && buf.candle.start < minTimestamp) {
          minTimestamp = buf.candle.start;
        }
      }

      // Handling abstract edge cases where minTimestamp cannot be found.
      if (minTimestamp === Infinity) {
        if (streamsEnded === numStreams) {
          out.push(null);
          reading = false;
        }
        return;
      }

      // 4. Aggregate all events at minTimestamp into a CandleBucket
      const bucket: CandleBucket = new Map();
      for (let i = 0; i < numStreams; i++) {
        const buf = buffers[i];
        if (buf !== null && buf.candle.start === minTimestamp) {
          bucket.set(buf.symbol, buf.candle);
          buffers[i] = null; // consume
        }
      }

      // 5. Yield the bucket and update backpressure state
      reading = out.push(bucket);
    }
  };

  // Attach listeners to handle internal node stream events synchronously
  for (let i = 0; i < numStreams; i++) {
    const s = streams[i];
    s.on('readable', tryProcess);
    s.on('end', () => {
      ended[i] = true;
      streamsEnded++;
      tryProcess();
    });
    s.on('error', err => {
      out.destroy(err);
    });
  }

  return out;
};
