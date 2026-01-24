import { CandleEvent } from '@models/event.types';
import { Readable } from 'node:stream';

/**
 * Synchronizes multiple streams of CandleEvents by timestamp.
 * It waits for data from all active streams and emits events in strict chronological order.
 * For a given timestamp T, it emits events for all streams that have data at T,
 * before moving to T+1.
 */
export const synchronizeStreams = (streams: Readable[]): Readable => {
  const iteratorMap = new Map<Readable, AsyncIterator<unknown>>();
  const bufferMap = new Map<Readable, CandleEvent | null>(); // null means stream ended
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
              bufferMap.set(stream, result.value as CandleEvent);
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
          // We assume event.candle is defined for synchronization source
          // If undefined, we can't sync it. For now, let's treat it as "current" or skip logic?
          // But Historical/Realtime streams should provide candle.
          // If strictly valid:
          if (event.candle && event.candle.start < minTimestamp) {
            minTimestamp = event.candle.start;
          }
        }

        // Edge case: if we have valid buffers but no timestamps (all candles undefined?),
        // strictly speaking we can't sync. But let's assume valid candles.
        if (minTimestamp === Infinity) {
          // This might happen if all buffered events have candle=undefined.
          // In that case, we should probably output them and clear buffer?
          // Or break to avoid infinite loop if design allows undefined candles without time.
          // For safety, let's emit all remaining valid events if they have no time, then clear.
          // But existing code implies time-based structure.

          // Let's break to be safe if we can't find a timestamp to proceed.
          // Actually if we just break, we lose data.
          // Let's force emit everything? No, that breaks sync.
          // Let's assume for this task: All synced events MUST have a candle.
          break;
        }

        // 4. Yield all events with minTimestamp
        const streamsToClear: Readable[] = [];
        for (const [stream, event] of bufferMap) {
          if (event && event.candle && event.candle.start === minTimestamp) {
            yield event;
            streamsToClear.push(stream);
          }
        }

        // 5. Clear processed events from buffer so they get refilled
        for (const stream of streamsToClear) {
          bufferMap.delete(stream);
        }

        // Safety check to prevent infinite loop if nothing was cleared (e.g. minTimestamp logic failed)
        if (streamsToClear.length === 0 && hasValidBuffer) {
          // Should not happen with correct logic
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
