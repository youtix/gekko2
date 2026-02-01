# Technical Specification: CandleBucket Stream Refactor

## Overview

This specification details a **big-bang refactor** to transition the entire stream pipeline from emitting individual `CandleEvent` objects to emitting aggregated `CandleBucket` objects. The goal is to provide a native multi-asset data structure that flows through streams and into plugins.

---

## Decision Summary

| Aspect | Decision |
|--------|----------|
| **Aggregation Point** | `synchronizeStreams` (emit `CandleBucket` directly) |
| **Plugin Interface** | `processInputStream(bucket: CandleBucket)` — clean break |
| **DummyExchange Interface** | `processOneMinuteBucket(bucket: CandleBucket)` — consistent |
| **Bucket Completeness** | All configured symbols **required** in every bucket |
| **Migration Strategy** | Big-bang — refactor all streams in a single pass |

---

## Type Changes

### `src/models/event.types.ts`

The existing types will be replaced:

```typescript
// REMOVE (deprecated)
export type CandleEvent = { ... };
export type SecuredCandleEvent = CandleEvent & { candle: Candle };

// CHANGE from Record to Map
export type CandleBucket = Map<TradingPair, Candle>;
```

> **Note**: Changing from `Record` to `Map` provides better iteration performance, explicit `.has()` checks, and consistent ordering. Update `OnCandleEventParams` in `strategy.types.ts` accordingly.

---

## File-by-File Changes

### 1. `src/utils/stream/stream.utils.ts`

**Current**: `synchronizeStreams()` yields individual `CandleEvent` objects per stream per timestamp.

**Refactor**: Aggregate all events with the same timestamp into a single `CandleBucket` before yielding.

```typescript
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { Readable } from 'node:stream';

export const synchronizeStreams = (streams: Readable[]): Readable => {
  const iteratorMap = new Map<Readable, AsyncIterator<{ symbol: TradingPair; candle: Candle }>>();
  const bufferMap = new Map<Readable, { symbol: TradingPair; candle: Candle } | null>();
  const activeStreams = new Set(streams);

  for (const stream of streams) {
    iteratorMap.set(stream, stream[Symbol.asyncIterator]());
  }

  async function* generator() {
    while (true) {
      // 1. Fill buffer for all active streams
      const pendingStreams: Readable[] = [];
      for (const stream of activeStreams) {
        if (!bufferMap.has(stream)) pendingStreams.push(stream);
      }

      if (pendingStreams.length > 0) {
        await Promise.all(pendingStreams.map(async stream => {
          const iterator = iteratorMap.get(stream)!;
          const result = await iterator.next();
          if (result.done) {
            activeStreams.delete(stream);
            bufferMap.set(stream, null);
          } else {
            bufferMap.set(stream, result.value);
          }
        }));
      }

      // 2. Check for remaining data
      const hasValidBuffer = Array.from(bufferMap.values()).some(v => v !== null);
      if (activeStreams.size === 0 && !hasValidBuffer) break;

      // 3. Find minimum timestamp
      let minTimestamp = Infinity;
      for (const event of bufferMap.values()) {
        if (event?.candle && event.candle.start < minTimestamp) {
          minTimestamp = event.candle.start;
        }
      }
      if (minTimestamp === Infinity) break;

      // 4. Aggregate all events at minTimestamp into a CandleBucket
      const bucket: CandleBucket = new Map();
      const streamsToClear: Readable[] = [];

      for (const [stream, event] of bufferMap) {
        if (event?.candle && event.candle.start === minTimestamp) {
          bucket.set(event.symbol, event.candle);
          streamsToClear.push(stream);
        }
      }

      // 5. Yield the bucket and clear processed entries
      yield bucket;
      for (const stream of streamsToClear) bufferMap.delete(stream);

      if (streamsToClear.length === 0 && hasValidBuffer) break;
    }
  }

  return Readable.from(generator());
};
```

---

### 2. Validation Transform Streams

These streams currently receive `CandleEvent` and must be refactored to receive `CandleBucket`.

#### `src/services/core/stream/validation/rejectFutureCandle.stream.ts`

```typescript
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
```

#### `src/services/core/stream/validation/rejectDuplicateCandle.stream.ts`

```typescript
import { CandleBucket } from '@models/event.types';
import { warning } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { differenceInMinutes } from 'date-fns';
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

      if (this.lastBucketTimestamp !== undefined) {
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
```

#### `src/services/core/stream/validation/fillCandleGap.stream.ts`

```typescript
import { ONE_MINUTE } from '@constants/time.const';
import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { warning } from '@services/logger';
import { createEmptyCandle } from '@utils/candle/candle.utils';
import { toISOString } from '@utils/date/date.utils';
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
      const expectedTimestamp = lastCandle.start + ONE_MINUTE;
      const currentCandle = bucket.values().next().value;
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
```

---

### 3. `src/services/core/stream/plugins.stream.ts`

**Current**: Receives `SecuredCandleEvent` with `{ symbol, candle }`.

**Refactor**: Receives `CandleBucket` directly.

```typescript
import { CandleBucket } from '@models/event.types';
import { Nullable } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { DummyExchange } from '@services/exchange/exchange.types';
import { isDummyExchange } from '@services/exchange/exchange.utils';
import { inject } from '@services/injecter/injecter';
import { info, warning } from '@services/logger';
import { Writable } from 'node:stream';

export class PluginsStream extends Writable {
  private readonly plugins: Plugin[];
  private readonly dummyExchange?: DummyExchange;
  private finalized = false;

  constructor(plugins: Plugin[]) {
    super({ objectMode: true });
    this.plugins = plugins;
    const exchange = inject.exchange();
    if (isDummyExchange(exchange)) this.dummyExchange = exchange;
  }

  public async _construct(callback: (error?: Error | null) => void): Promise<void> {
    try {
      for (const plugin of this.plugins) await plugin.processInitStream();
      callback();
    } catch (error) {
      if (error instanceof Error) callback(error);
      else callback(new Error(`Error when initializing stream plugin: ${error}`));
    }
  }

  public async _write(bucket: CandleBucket, _: BufferEncoding, done: (error?: Nullable<Error>) => void) {
    try {
      // Forward bucket to dummy exchange (if set by user) before all plugins
      await this.dummyExchange?.processOneMinuteBucket(bucket);

      // Forward bucket to all plugins concurrently
      await Promise.all(this.plugins.map(plugin => plugin.processInputStream(bucket)));

      // Broadcast all deferred events sequentially
      for (const plugin of this.plugins) {
        while (await plugin.broadcastDeferredEmit()) {
          // Continue looping while at least one plugin emitted an event
        }
      }

      done();
    } catch (error) {
      await this.finalizeAllPlugins();
      info('stream', 'Gekko is closing the application due to an error!');
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ... _final and finalizeAllPlugins remain unchanged
}
```

---

### 4. `src/plugins/plugin.ts`

**Current**: `processInputStream(symbol: TradingPair, candle: Candle)`

**Refactor**: `processInputStream(bucket: CandleBucket)`

```typescript
import { Timeframe, Watch } from '@models/configuration.types';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { Exchange } from '@services/exchange/exchange.types';
import { Storage } from '@services/storage/storage';
import { SequentialEventEmitter } from '@utils/event/sequentialEventEmitter';
import { config } from '../services/configuration/configuration';
import { PluginMissingServiceError } from './plugin.error';

export abstract class Plugin extends SequentialEventEmitter {
  // ... existing properties
  
  /** Invoked once immediately after plugin instantiation before any candles are processed. */
  public async processInitStream() {
    await this.processInit();
  }

  /** Executed for every new CandleBucket after it passes through the stream pipeline. */
  public async processInputStream(bucket: CandleBucket) {
    await this.processOneMinuteBucket(bucket);
  }

  /** Invoked once when the stream pipeline terminates. */
  public async processCloseStream() {
    await this.processFinalize();
  }

  protected abstract processInit(): void;
  protected abstract processOneMinuteBucket(bucket: CandleBucket): void;
  protected abstract processFinalize(): void;
}
```

---

### 5. `src/services/exchange/exchange.types.ts`

**Current**: `DummyExchange` has `processOneMinuteCandle(symbol, candle)`.

**Refactor**:

```typescript
import { CandleBucket } from '@models/event.types';

// ...existing interface...

export type DummyExchange = Exchange & { 
  processOneMinuteBucket: (bucket: CandleBucket) => Promise<void> 
};
```

---

### 6. `src/services/exchange/dummy/dummyCentralizedExchange.ts`

**Current**: `processOneMinuteCandle(symbol, candle)`

**Refactor**:

```typescript
public async processOneMinuteBucket(bucket: CandleBucket): Promise<void> {
  return this.mutex.runExclusive(() => {
    for (const [symbol, candle] of bucket) {
      this.currentTimestamp = addMinutes(candle.start, 1).getTime();
      const oldCandles = this.candles.get(symbol) ?? [];
      this.candles.set(symbol, [...oldCandles, candle]);
      this.ticker.set(symbol, { bid: candle.close, ask: candle.close });
      this.settleOrdersWithCandle(symbol, candle);
    }
  });
}
```

---

### 7. All Plugin Implementations

Each concrete plugin that extends `Plugin` must update its `processOneMinuteCandle` to `processOneMinuteBucket`:

| Plugin | File |
|--------|------|
| `CandleWriter` | `src/plugins/candleWriter/candleWriter.ts` |
| `EventSubscriber` | `src/plugins/eventSubscriber/eventSubscriber.ts` |
| `PerformanceReporter` | `src/plugins/performanceReporter/performanceReporter.ts` |
| `PortfolioAnalyzer` | `src/plugins/portfolioAnalyzer/portfolioAnalyzer.ts` |
| `RoundTripAnalyzer` | `src/plugins/roundTripAnalyzer/roundTripAnalyzer.ts` |
| `Supervision` | `src/plugins/supervision/supervision.ts` |
| `TradingAdvisor` | `src/plugins/tradingAdvisor/tradingAdvisor.ts` |
| `Trader` | `src/plugins/trader/trader.ts` |

Each plugin should either:
- Iterate over `bucket.entries()` or `for (const [symbol, candle] of bucket)` if it needs per-symbol logic
- Access a specific symbol via `bucket.get(this.primarySymbol)` if applicable

---

### 8. Multi-Asset Stream Wrappers

These files use `synchronizeStreams` and forward individual `CandleEvent` objects. After this refactor, they will forward `CandleBucket` objects directly:

- `src/services/core/stream/backtest/multiAssetBacktest.stream.ts`
- `src/services/core/stream/multiAssetHistorical.stream.ts`

No internal logic changes required — they simply forward what `synchronizeStreams` emits.

---

## Deprecated / Removed Types

| Type | Action |
|------|--------|
| `CandleEvent` | **REMOVE** — replaced by `CandleBucket` |
| `SecuredCandleEvent` | **REMOVE** — no longer needed |

Update all imports and usages across the codebase.

---

## Test Files Requiring Updates

| Test File | Reason |
|-----------|--------|
| `src/utils/stream/stream.utils.test.ts` | `synchronizeStreams` output format changed |
| `src/services/core/stream/plugins.stream.test.ts` | `_write` signature changed |
| `src/services/core/stream/validation/*.test.ts` | Transform input format changed |
| `src/plugins/*/*.test.ts` | `processOneMinuteCandle` → `processOneMinuteBucket` |

---

## Migration Checklist

- [ ] Update `synchronizeStreams` to emit `CandleBucket`
- [ ] Update `stream.utils.test.ts`
- [ ] Update `RejectFutureCandleStream`
- [ ] Update `RejectDuplicateCandleStream`
- [ ] Update `FillCandleGapStream`
- [ ] Update `PluginsStream`
- [ ] Update `plugins.stream.test.ts`
- [ ] Update `Plugin` abstract class
- [ ] Update `DummyExchange` type
- [ ] Update `DummyCentralizedExchange`
- [ ] Update `PaperTradingBinanceExchange`
- [ ] Update all concrete plugins (8 files)
- [ ] Update all plugin tests
- [ ] Remove `CandleEvent` and `SecuredCandleEvent` from `event.types.ts`
- [ ] Run full test suite
- [ ] Run TypeScript type check

---

## Estimated Impact

| Category | File Count |
|----------|------------|
| Stream utilities | 2 |
| Validation streams | 3 |
| Plugin infrastructure | 2 |
| Concrete plugins | 8 |
| Exchange layer | 3 |
| Type definitions | 1 |
| Test files | ~15 |
| **Total** | **~34 files** |
