# E2E Step 3: Backtest Mode

## Goal
Verify that the `Backtest` pipeline loads data from the database, runs the strategy, and produces a valid performance report.

## Test Scenario
1. **Setup**:
   - Seed the SQLite database with 1000 candles (via direct SQL injection or reusing the Importer verification helper).
   - Pattern: "Bull Run" (Price goes 100 -> 200).
2. **Action**:
   - Start Gekko2 in `backtest` mode.
   - Strategy: `LinearTrendStrategy` (A simple test strategy that buys if price > prev_price).
3. **Verification**:
   - **Report**: Inspect the returned `PerformanceReport` object.
     - Assert `profit > 0` (since it's a bull run and we bought).
     - Assert `trades > 0`.
   - **Database**:
     - (Optional) Check if backtest result was saved if that feature is enabled.

## Implementation Details
- **Seeding**: Create a `seedDatabase(dbParams, candles)` utility.
- **Strategy**: Use a built-in or a simple "MockStrategy" registered specifically for E2E to ensure deterministic signals.
