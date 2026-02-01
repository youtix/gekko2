# CandleBucketBatcher Refactor — Technical Specification

## Overview

This specification describes the refactoring of `CandleBatcher` to support `CandleBucket` (multi-asset candle processing) with a focus on performance optimization. The goal is to create a new `CandleBucketBatcher` facade that wraps optimized internal batchers, enabling efficient batch processing in the `TradingAdvisor` plugin.

## Motivation

The current implementation in `TradingAdvisor.processOneMinuteBucket()` iterates over each trading pair individually, performing Map lookups on every iteration. This creates unnecessary overhead when processing multi-asset portfolios. Additionally, the existing `CandleBatcher.createBigCandleFrom()` uses spread operators and `reduce()`, which allocate new objects on each aggregation.

### Performance Targets

1. **Reduce object allocations** — Mutate candles in-place during aggregation
2. **Reduce Map lookups** — Minimize per-pair overhead in the hot path
3. **Leverage batch operations** — Process entire buckets atomically

---

## Architecture

### Class Hierarchy

```
CandleBucketBatcher (public facade)
└── FastCandleBatcher[] (internal, optimized per-pair batchers)
```

### File Structure

```
src/services/core/batcher/candleBatcher/
├── candleBatcher.ts           # Existing (unchanged, for backwards compatibility)
├── candleBatcher.types.ts     # Existing
├── candlebatcher.test.ts      # Will be refactored
├── candleBucketBatcher.ts     # NEW — public facade
└── fastCandleBatcher.ts       # NEW — optimized internal batcher
```

---

## Type Definitions

### Existing Types (unchanged)

```typescript
// src/models/event.types.ts
export type CandleBucket = Map<TradingPair, Candle>;

// src/services/core/batcher/candleBatcher/candleBatcher.types.ts
export type CandleSize = number; // minutes
```

### New Types

```typescript
// src/services/core/batcher/candleBatcher/candleBucketBatcher.types.ts
export interface CandleBucketBatcherConfig {
  pairs: TradingPair[];
  candleSize: CandleSize;
}
```

---

## Implementation Details

### 1. FastCandleBatcher (Internal)

An optimized, allocation-minimal batcher for internal use only.

```typescript
// fastCandleBatcher.ts
import { Candle } from '@models/candle.types';
import { addPrecise } from '@utils/math/math.utils';
import { CandleSize } from './candleBatcher.types';

/**
 * Optimized candle batcher that mutates in-place to minimize allocations.
 * For internal use by CandleBucketBatcher only.
 */
export class FastCandleBatcher {
  private accumulator: Candle | null = null;
  private count = 0;
  private readonly candleSize: CandleSize;

  constructor(candleSize: CandleSize) {
    this.candleSize = candleSize;
  }

  /**
   * Add a 1-minute candle. Returns the completed timeframe candle if ready.
   * IMPORTANT: The returned candle is owned by this batcher; clone if you need to keep it.
   */
  addCandle(candle: Candle): Candle | null {
    if (this.accumulator === null) {
      // First candle: shallow clone without `id`
      this.accumulator = {
        start: candle.start,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        vwp: candle.vwp,
        trades: candle.trades,
      };
    } else {
      // Aggregate in-place
      this.accumulator.high = Math.max(this.accumulator.high, candle.high);
      this.accumulator.low = Math.min(this.accumulator.low, candle.low);
      this.accumulator.close = candle.close;
      this.accumulator.volume = addPrecise(this.accumulator.volume, candle.volume);
    }

    this.count++;

    if (this.isBigCandleReady(candle)) {
      const result = this.accumulator;
      this.accumulator = null;
      this.count = 0;
      return result;
    }

    return null;
  }

  private isBigCandleReady(currentCandle: Candle): boolean {
    const date = new Date(currentCandle.start);
    const size = this.candleSize;
    const minute = date.getUTCMinutes();
    const hour = date.getUTCHours();
    const day = date.getUTCDate();
    const month = date.getUTCMonth();
    const weekday = date.getUTCDay();

    if (size < 60) return minute % size === size - 1;
    if (size < 1440) {
      const hours = size / 60;
      return minute === 59 && hour % hours === hours - 1;
    }
    if (size < 10080) return hour === 23 && minute === 59;
    if (size === 10080) return weekday === 0 && hour === 23 && minute === 59;
    if (size === 43200) return this.isMonthEnd(date);
    if (size === 129600) return (month + 1) % 3 === 0 && this.isMonthEnd(date);
    if (size === 259200) return [5, 11].includes(month) && this.isMonthEnd(date);
    if (size === 518400) return month === 11 && day === 31 && hour === 23 && minute === 59;
    return false;
  }

  private isMonthEnd(date: Date): boolean {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return date.getUTCDate() === lastDay && date.getUTCHours() === 23 && date.getUTCMinutes() === 59;
  }
}
```

**Key Differences from `CandleBatcher`:**

| Aspect | CandleBatcher | FastCandleBatcher |
|--------|---------------|-------------------|
| Storage | `Candle[]` array | Single `Candle \| null` accumulator |
| Aggregation | `reduce()` with spreads | In-place mutation |
| Object creation | N allocations per timeframe | 1 allocation per timeframe |
| `id` handling | Uses `lodash.omit()` | Manual destructuring (no lodash) |

---

### 2. CandleBucketBatcher (Public Facade)

```typescript
// candleBucketBatcher.ts
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
    this.batchers = new Map(
      pairs.map(pair => [pair, new FastCandleBatcher(candleSize)])
    );
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
        throw new Error(
          `CandleBucketBatcher: Missing candle for pair "${pair}". ` +
          `Expected pairs: [${[...this.pairs].join(', ')}]`
        );
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
```

**Design Decisions:**

1. **Fail-fast validation**: Throws immediately if a bucket is missing a registered pair. This ensures data integrity issues are caught early (before the batcher).

2. **Ignore unregistered pairs**: If the bucket contains extra pairs not in the constructor, they are silently ignored. This allows flexibility when the upstream provides more data than needed.

3. **Atomic emission**: Returns a completed bucket only when ALL pairs have reached the timeframe boundary. Since all 1-minute candles share the same timestamp, this should always happen atomically.

4. **Ownership transfer**: The returned `CandleBucket` is a new `Map` instance. The caller owns it and can safely mutate or store it.

---

### 3. TradingAdvisor Integration

The changes to `TradingAdvisor` are minimal:

```typescript
// Before (current implementation)
import { CandleBatcher } from '@services/core/batcher/candleBatcher/candleBatcher';

export class TradingAdvisor extends Plugin {
  private candleBatchers: Map<TradingPair, CandleBatcher>;
  private candleBucket: Map<TradingPair, Candle>;

  constructor({ name, strategyName, strategyPath }: TradingAdvisorConfiguration) {
    // ...
    const timeframeInMinutes = TIMEFRAME_TO_MINUTES[this.timeframe];
    this.candleBatchers = new Map(this.pairs.map(pair => [pair, new CandleBatcher(timeframeInMinutes)]));
    this.candleBucket = new Map();
    // ...
  }

  protected processOneMinuteBucket(bucket: CandleBucket) {
    const firstCandle = bucket.values().next().value;
    if (firstCandle) this.strategyManager?.setCurrentTimestamp(firstCandle.start);

    for (const [symbol, candle] of bucket) {
      const batcher = this.candleBatchers.get(symbol);
      const newCandle = batcher?.addSmallCandle(candle);
      if (newCandle) this.processNewTimeframeCandle(symbol, newCandle);
    }
  }
}
```

```typescript
// After (refactored)
import { CandleBucketBatcher } from '@services/core/batcher/candleBatcher/candleBucketBatcher';

export class TradingAdvisor extends Plugin {
  private bucketBatcher: CandleBucketBatcher;

  constructor({ name, strategyName, strategyPath }: TradingAdvisorConfiguration) {
    // ...
    const timeframeInMinutes = TIMEFRAME_TO_MINUTES[this.timeframe];
    this.bucketBatcher = new CandleBucketBatcher(this.pairs, timeframeInMinutes);
    // ...
  }

  protected processOneMinuteBucket(bucket: CandleBucket) {
    const firstCandle = bucket.values().next().value;
    if (firstCandle) this.strategyManager?.setCurrentTimestamp(firstCandle.start);

    const timeframeBucket = this.bucketBatcher.addBucket(bucket);
    if (timeframeBucket) {
      this.strategyManager?.onTimeFrameCandle(timeframeBucket);
      this.addDeferredEmit(TIMEFRAME_CANDLE_EVENT, timeframeBucket);
    }
  }
}
```

**Changes Summary:**

| Aspect | Before | After |
|--------|--------|-------|
| Properties | `candleBatchers` + `candleBucket` (2 Maps) | `bucketBatcher` (1 instance) |
| Processing | for-loop with Map.get() | Single `addBucket()` call |
| `processNewTimeframeCandle()` | Required | **Removed** (inlined) |
| Lines of code | ~12 | ~6 |

---

## Test Plan

### Refactoring `candlebatcher.test.ts`

The existing test file will be refactored to:

1. **Add tests for `FastCandleBatcher`** — Unit tests mirroring the existing `CandleBatcher` tests
2. **Add tests for `CandleBucketBatcher`** — Integration tests for bucket-level operations
3. **Keep `CandleBatcher` tests** — For backwards compatibility (if the class is still exported)

#### New Test Cases for CandleBucketBatcher

```typescript
describe('CandleBucketBatcher', () => {
  describe('constructor', () => {
    it('should initialize with given pairs and candle size');
    it('should report correct pairCount');
  });

  describe('addBucket', () => {
    it('should return undefined before timeframe boundary');
    it('should return completed bucket at timeframe boundary');
    it('should throw if bucket is missing a registered pair');
    it('should ignore unregistered pairs in the bucket');
    it('should handle single-pair buckets');
    it('should handle multi-pair buckets');
  });

  describe('timeframe boundaries', () => {
    it('should aggregate 5-minute candles correctly');
    it('should aggregate hourly candles correctly');
    it('should aggregate daily candles correctly');
    // ... other timeframes
  });

  describe('performance', () => {
    it('should not allocate new objects during aggregation (memory benchmark)');
  });
});
```

---

## Migration Checklist

- [ ] Create `fastCandleBatcher.ts`
- [ ] Create `candleBucketBatcher.ts`
- [ ] Create `candleBucketBatcher.types.ts` (if needed)
- [ ] Refactor `candlebatcher.test.ts` to include new tests
- [ ] Update `TradingAdvisor` to use `CandleBucketBatcher`
- [ ] Update `tradingAdvisor.test.ts` accordingly
- [ ] Run full test suite
- [ ] Run benchmarks to validate performance improvements
- [ ] Update barrel exports (`index.ts`) if applicable

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| In-place mutation could cause bugs if caller reuses candles | Clear documentation + ownership transfer semantics |
| `FastCandleBatcher` duplicates logic from `CandleBatcher` | Accept duplication for performance; keep original for external use |
| Throwing on missing pairs could break existing pipelines | Ensure upstream gap-filling streams are in place |

---

## Future Considerations

1. **Pooling**: For extreme performance, candle objects could be pulled from a pool instead of allocated fresh.
2. **SIMD/Vectorization**: If the platform supports it, OHLCV aggregation could be vectorized.
3. **Streaming API**: A generator-based `addBucket*()` could integrate better with async iterators.

---

## Appendix: Candle Type Reference

```typescript
// src/models/candle.types.ts
export interface Candle {
  id?: number;
  start: number;    // Unix timestamp (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwp: number;      // Volume-weighted price
  trades: number;
}
```
