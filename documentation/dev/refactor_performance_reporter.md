# Blueprint: Refactor Performance Reporter

**Goal**: Refactor the `PerformanceReporter` plugin to support both `PortfolioReport` (from PortfolioAnalyzer) and `TradingReport` (from RoundTripAnalyzer) with a unified, modern, single-file CSV output.

## 1. Scope & Requirements
- **Output File**: `performanceReporter.csv` (default if no file name is specified).
- **Mode**: Single strategy context. The plugin detects usage via report ID and formats accordingly.
- **Persistence**: Append-only execution.
- **Formatting**: Internal formatting (strings with units like `%`) for readability, as requested.
- **Breaking Changes**:
  - Removal of `roundtrips.csv`.
  - CSV header names modernization (standardizing on property names).

## 2. Architecture
The `PerformanceReporter` will act as a polymorphic writer. It will inspect the `id` of the incoming report to determine the "Strategy" for writing.

### 2.1 File Management
- **Initialization**: checking if `performanceReporter.csv` exists.
- **Lazy Header Writing**:
  - If the file is empty/non-existent *at the time of the first report*, write the header corresponding to that report type.
  - If the file has content, skip header generation and strictly append.
  - *Note*: It is assumed the user manages file lifecycle (clearing between distinct testing sessions) or accepts hybrid files if mixing analyzer runs.

### 2.2 Report Handling
The `onPerformanceReport` handler will dispatch logic based on the `report.id`.

#### A. Portfolio Report Handler
**Trigger**: `id === 'PORTFOLIO PROFIT REPORT'`
**Columns**:
1. `id`
2. `start time`
3. `end time`
4. `duration`
5. `exposure %`
6. `start equity`
7. `end equity`
8. `market return %`
9. `alpha`
10. `annualized return %`
11. `max drawdown %`
12. `longest drawdown duration`
13. `sharpe ratio`
14. `sortino ratio`

#### B. Trading Report Handler
**Trigger**: `id === 'TRADING REPORT'`
**Columns**:
1. `id`
2. `start time`
3. `end time`
4. `duration`
5. `exposure %`
6. `start balance`
7. `final balance`
8. `market return %`
9. `alpha`
10. `annualized return %`
11. `win rate %`
12. `trade count`
13. `sharpe ratio`
14. `sortino ratio`

### 2.3 Legacy Clean-up
- Remove all code related to `roundtrips.csv`.
- Remove `roundTripHeader` and `roundTripFilePath`.

## 3. Implementation Details

### Imports
- Import `PortfolioReport` from `@plugins/analyzers/portfolioAnalyzer/portfolioAnalyzer.types`
- Import `TradingReport` from `@plugins/analyzers/roundTripAnalyzer/roundTrip.types`

### Helpers
- Use `fs.lockSync` for concurrency safety (existing pattern).
- Use `Intl.NumberFormat` and existing math utils for formatting.
