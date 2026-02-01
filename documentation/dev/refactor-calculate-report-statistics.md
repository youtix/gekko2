# Technical Specification: Refactor `calculateReportStatistics`

## Overview

Refactor the monolithic `calculateReportStatistics` function in `PerformanceAnalyzer` to follow SOLID principles by extracting pure utility functions into `src/utils/finance/stats.utils.ts`.

## Goals

- **Reusability**: Extract financial calculations into a shared utility module for use across the codebase.
- **Readability/Maintainability**: Decompose an 80-line function into focused, single-responsibility functions.
- **Testability**: Enable isolated unit testing of each calculation.

## Current State Analysis

### Location
`src/plugins/analyzers/roundTripAnalyzer/roundTripAnalyzer.ts` (lines 170-250)

### Existing Utilities
The codebase already has related functions in `src/utils/math/math.utils.ts`:
- `sharpeRatio()` - Annualized Sharpe ratio
- `sortinoRatio()` - Annualized Sortino ratio  
- `stdev()` - Standard deviation
- `maxDrawdown()` - Maximum drawdown percentage
- `longestDrawdownDuration()` - Longest drawdown in milliseconds

**Issue**: The current `calculateReportStatistics` duplicates Sharpe/Sortino logic inline instead of reusing these utilities.

### Calculations to Extract

| # | Calculation | Current Lines | Args Count | Type Strategy |
|---|-------------|---------------|------------|---------------|
| 1 | `calculateElapsedYears` | 183-188 | 2 | Inline params |
| 2 | `calculateTotalReturnPct` | 197 | 2 | Inline params |
| 3 | `calculateAnnualizedReturnPct` | 198 | 2 | Inline params |
| 4 | `calculateExposurePct` | 200 | 3 | Inline params |
| 5 | `calculateAlpha` | 226 | 2 | Inline params |
| 6 | `calculateMarketReturnPct` | 216 | 2 | Inline params |
| 7 | `calculateWinRate` | 214 | 2 | Inline params |
| 8 | `calculateDownsideDeviation` | 206-209 | 1 | Inline params |
| 9 | `extractTopMAEs` | 218-222 | 2 | Inline params |

**Note**: Sharpe and Sortino ratios should **reuse existing functions** from `math.utils.ts` instead of creating new ones.

---

## New File: `src/utils/finance/stats.utils.ts`

### File Structure

```typescript
/**
 * @fileoverview Financial and statistical utility functions for trading analysis.
 * All functions are pure, stateless, and throw errors for invalid inputs.
 */

import { addYears, differenceInMilliseconds, differenceInYears } from 'date-fns';

// ============================================================================
// TYPES
// ============================================================================

/** Input for downside deviation calculation */
export interface DownsideDeviationInput {
  profits: number[];
}

// ============================================================================
// TIME CALCULATIONS
// ============================================================================

/**
 * Calculates elapsed years between two dates, accounting for leap years.
 * Uses precise fractional calculation for partial years.
 *
 * @param startDate - Start timestamp (epoch milliseconds)
 * @param endDate - End timestamp (epoch milliseconds)
 * @returns Elapsed time in years (fractional)
 * @throws Error if endDate is before startDate
 */
export const calculateElapsedYears = (startDate: number, endDate: number): number => {
  if (endDate < startDate) {
    throw new Error('endDate must be greater than or equal to startDate');
  }

  const fullYears = differenceInYears(endDate, startDate);
  const remainderStart = addYears(startDate, fullYears);
  const nextYearEnd = addYears(remainderStart, 1);
  const msInCurrentYear = differenceInMilliseconds(nextYearEnd, remainderStart);

  return fullYears + differenceInMilliseconds(endDate, remainderStart) / msInCurrentYear;
};

// ============================================================================
// RETURN CALCULATIONS
// ============================================================================

/**
 * Calculates total return as a percentage.
 *
 * @param currentEquity - Current portfolio value
 * @param startEquity - Initial portfolio value
 * @returns Total return percentage (e.g., 25.5 for 25.5%)
 * @throws Error if startEquity is zero or negative
 */
export const calculateTotalReturnPct = (currentEquity: number, startEquity: number): number => {
  if (startEquity <= 0) {
    throw new Error('startEquity must be greater than zero');
  }
  return (currentEquity / startEquity) * 100 - 100;
};

/**
 * Calculates annualized return percentage.
 *
 * @param totalReturnPct - Total return as percentage
 * @param elapsedYears - Time period in years
 * @returns Annualized return percentage
 * @throws Error if elapsedYears is zero or negative
 */
export const calculateAnnualizedReturnPct = (totalReturnPct: number, elapsedYears: number): number => {
  if (elapsedYears <= 0) {
    throw new Error('elapsedYears must be greater than zero');
  }
  return totalReturnPct / elapsedYears;
};

/**
 * Calculates market return percentage (buy-and-hold benchmark).
 *
 * @param endPrice - Price at end of period
 * @param startPrice - Price at start of period
 * @returns Market return percentage
 * @throws Error if startPrice is zero or negative
 */
export const calculateMarketReturnPct = (endPrice: number, startPrice: number): number => {
  if (startPrice <= 0) {
    throw new Error('startPrice must be greater than zero');
  }
  return ((endPrice - startPrice) / startPrice) * 100;
};

/**
 * Calculates alpha (excess return over benchmark).
 *
 * @param totalReturnPct - Strategy's total return percentage
 * @param marketReturnPct - Benchmark (market) return percentage
 * @returns Alpha as percentage points
 */
export const calculateAlpha = (totalReturnPct: number, marketReturnPct: number): number => {
  return totalReturnPct - marketReturnPct;
};

// ============================================================================
// EXPOSURE & WIN RATE
// ============================================================================

/**
 * Calculates exposure percentage (time in market).
 *
 * @param exposureMs - Total time exposed to market (milliseconds)
 * @param totalMs - Total period duration (milliseconds)
 * @returns Exposure as percentage (0-100)
 * @throws Error if totalMs is zero or negative
 */
export const calculateExposurePct = (exposureMs: number, totalMs: number): number => {
  if (totalMs <= 0) {
    throw new Error('totalMs must be greater than zero');
  }
  return (exposureMs / totalMs) * 100;
};

/**
 * Calculates win rate (percentage of profitable trades).
 *
 * @param winningTrades - Number of profitable trades
 * @param totalTrades - Total number of trades
 * @returns Win rate as percentage, or null if no trades
 */
export const calculateWinRate = (winningTrades: number, totalTrades: number): number | null => {
  if (totalTrades <= 0) {
    return null;
  }
  return (winningTrades / totalTrades) * 100;
};

// ============================================================================
// RISK METRICS
// ============================================================================

/**
 * Calculates downside deviation (volatility of negative returns only).
 * Uses root mean square of negative returns.
 *
 * @param profits - Array of profit percentages per trade
 * @returns Downside deviation as percentage
 */
export const calculateDownsideDeviation = (profits: number[]): number => {
  if (!profits.length) return 0;

  const sumSquaredDownside = profits.reduce(
    (sum, profit) => (profit < 0 ? sum + Math.pow(profit, 2) : sum),
    0
  );

  return Math.sqrt(sumSquaredDownside / profits.length);
};

/**
 * Extracts the top N largest Maximum Adverse Excursions (MAE).
 *
 * @param maes - Array of MAE values from round trips
 * @param limit - Maximum number of MAEs to return (default: 10)
 * @returns Sorted array of top MAE values (descending)
 */
export const extractTopMAEs = (maes: number[], limit: number = 10): number[] => {
  return maes
    .filter((value): value is number => Number.isFinite(value) && value >= 0)
    .sort((left, right) => right - left)
    .slice(0, limit);
};
```

---

## Refactored `calculateReportStatistics`

After extracting utilities, the main function becomes a clean orchestrator:

```typescript
import {
  calculateElapsedYears,
  calculateTotalReturnPct,
  calculateAnnualizedReturnPct,
  calculateMarketReturnPct,
  calculateAlpha,
  calculateExposurePct,
  calculateWinRate,
  calculateDownsideDeviation,
  extractTopMAEs,
} from '@utils/finance/stats.utils';
import { sharpeRatio, sortinoRatio } from '@utils/math/math.utils';
import { round } from '@utils/math/round.utils';

private calculateReportStatistics(): TradingReport {
  if (!this.start.equity || !this.start.portfolio) {
    warning('roundtrip analyzer', 'No portfolio data received. Emitting empty report.');
    return EMPTY_TRADING_REPORT;
  }

  // Time calculations
  const timespan = intervalToDuration({ start: this.dates.start, end: this.dates.end });
  const elapsedYears = calculateElapsedYears(this.dates.start, this.dates.end);

  if (elapsedYears < 0.01) {
    warning(
      'roundtrip analyzer',
      `Elapsed period is very short (${elapsedYears.toFixed(4)} years). Annualized metrics may be unreliable.`,
    );
  }

  // Core return metrics
  const netProfit = this.currentEquity - this.start.equity;
  const totalReturnPct = calculateTotalReturnPct(this.currentEquity, this.start.equity);
  const annualizedReturnPct = calculateAnnualizedReturnPct(totalReturnPct, Math.max(elapsedYears, 0.01));
  const marketReturnPct = calculateMarketReturnPct(this.endPrice, this.startPrice);

  // Exposure and trades
  const totalMs = differenceInMilliseconds(this.dates.end, this.dates.start);
  const exposurePct = calculateExposurePct(this.exposure, totalMs);
  const positiveRoundtrips = this.roundTrips.filter(rt => rt.pnl > 0);
  const winRate = calculateWinRate(positiveRoundtrips.length, this.roundTrips.length);

  // Risk metrics
  const allProfits = this.roundTrips.map(r => r.profit);
  const downsideDeviation = calculateDownsideDeviation(allProfits);

  const ratioParams = {
    returns: allProfits,
    yearlyProfit: annualizedReturnPct,
    riskFreeReturn: this.riskFreeReturn,
    elapsedYears: Math.max(elapsedYears, 0.01),
  };

  const report: TradingReport = {
    id: 'TRADING REPORT',
    alpha: calculateAlpha(totalReturnPct, marketReturnPct),
    finalBalance: this.currentEquity,
    downsideDeviation,
    periodEndAt: this.dates.end,
    periodStartAt: this.dates.start,
    exposurePct,
    marketReturnPct,
    netProfit,
    winRate: winRate !== null ? round(winRate, 4) : null,
    topMAEs: extractTopMAEs(this.roundTrips.map(rt => rt.maxAdverseExcursion)),
    totalReturnPct,
    annualizedReturnPct,
    sharpeRatio: sharpeRatio(ratioParams),
    sortinoRatio: sortinoRatio(ratioParams),
    volatility: stdev(allProfits) || 0,
    startBalance: this.start.equity,
    startPrice: this.startPrice,
    endPrice: this.endPrice,
    formattedDuration: formatDuration(timespan),
    tradeCount: this.tradeCount,
    annualizedNetProfit: netProfit / (elapsedYears || 1),
  };

  return report;
}
```

---

## Test File: `src/utils/finance/stats.utils.test.ts`

Use the **unit-test-craftsman** skill to create comprehensive tests covering:

### Test Cases per Function

| Function | Test Cases |
|----------|------------|
| `calculateElapsedYears` | Same day (0 years), exactly 1 year, leap year handling, fractional years, **throws on endDate < startDate** |
| `calculateTotalReturnPct` | Positive return, negative return, zero change, **throws on startEquity <= 0** |
| `calculateAnnualizedReturnPct` | Multi-year period, sub-year period, **throws on elapsedYears <= 0** |
| `calculateMarketReturnPct` | Price increase, price decrease, **throws on startPrice <= 0** |
| `calculateAlpha` | Positive alpha, negative alpha, zero alpha |
| `calculateExposurePct` | Full exposure (100%), partial exposure, no exposure, **throws on totalMs <= 0** |
| `calculateWinRate` | All wins, all losses, mixed, **returns null on 0 trades** |
| `calculateDownsideDeviation` | No losses, all losses, mixed, empty array |
| `extractTopMAEs` | More than 10 MAEs, fewer than 10, empty array, negative values filtered |

---

## Implementation Checklist

### Phase 1: Create Utility File
- [ ] Create `src/utils/finance/stats.utils.ts`
- [ ] Implement all 9 exported functions with JSDoc
- [ ] Add appropriate error throwing for invalid inputs

### Phase 2: Create Tests
- [ ] Load **unit-test-craftsman** skill
- [ ] Create `src/utils/finance/stats.utils.test.ts`
- [ ] Cover all functions with edge cases
- [ ] Run tests to verify: `bun test stats.utils`

### Phase 3: Refactor Analyzer
- [ ] Update imports in `roundTripAnalyzer.ts`
- [ ] Replace inline calculations with utility function calls
- [ ] Reuse existing `sharpeRatio`/`sortinoRatio` from `math.utils.ts`
- [ ] Remove duplicated inline calculations

### Phase 4: Validation
- [ ] Run full test suite: `bun test`
- [ ] Verify no regressions in existing `roundTripAnalyzer` tests

---

## File Structure After Refactoring

```
src/
├── utils/
│   ├── finance/
│   │   ├── stats.utils.ts        # NEW
│   │   └── stats.utils.test.ts   # NEW
│   └── math/
│       └── math.utils.ts         # Existing (reuse sharpeRatio, sortinoRatio)
└── plugins/
    └── analyzers/
        └── roundTripAnalyzer/
            └── roundTripAnalyzer.ts  # REFACTORED
```

---

## SOLID Principles Applied

| Principle | Application |
|-----------|-------------|
| **Single Responsibility** | Each utility function has one job |
| **Open/Closed** | New metrics can be added without modifying existing functions |
| **Liskov Substitution** | N/A (no inheritance) |
| **Interface Segregation** | Functions take only the parameters they need |
| **Dependency Inversion** | Analyzer depends on abstract utility functions, not concrete implementations |

---

## Notes

- **Error Strategy**: Functions throw errors for invalid inputs (fail fast). The caller (`calculateReportStatistics`) should handle edge cases before calling utilities.
- **Backward Compatibility**: The refactored function produces identical output to the original.
- **Performance**: No performance impact; function calls add negligible overhead.
