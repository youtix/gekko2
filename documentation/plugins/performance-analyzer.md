# Performance Analyzer Plugin

The **PerformanceAnalyzer** plugin is responsible for tracking and reporting the performance of a trading strategy over time. It listens to portfolio value changes and executed trades, calculates advanced performance metrics (Sharpe ratio, Sortino ratio, alpha, etc.), and emits performance reports after every trade and at the end of the run.

This plugin is useful for both backtests and live runs to evaluate how profitable and stable a strategy is.

```
💡 Note:
- This plugin is read-only. It only analyzes and reports.
- Requires data from the `Trader` plugin to function correctly.
- Designed to work in both realtime and backtest modes.
```

## Configuration

In your configuration file, under the `plugins` section, configure the PerformanceAnalyzer plugin like this:

```yaml
plugins:
  - name: PerformanceAnalyzer # Must be set to PerformanceAnalyzer
    riskFreeReturn: 5         # Optional: annualized % return of a risk-free asset (e.g., government bonds)
```

## Events Emitted

The **PerformanceAnalyzer** plugin emits a number of events that are used to track performance and roundtrips.

| Event                 | Description                                                                 |
|-----------------------|-----------------------------------------------------------------------------|
| `performanceReport`   | Emitted after each trade with a full performance report.                    |
| `roundtrip`           | Emitted when a full roundtrip (buy → sell) has been completed.              |
| `roundtripUpdate`     | Emitted on every candle when a roundtrip is open to update unrealized PnL.  |


## Metrics Calculated

Here are the metrics reported in the `performanceReport` event:

| Metric                     | Description                                                                        |
|----------------------------|------------------------------------------------------------                        |
| `balance`                  | Current portfolio balance in the configured currency.                              |
| `profit`                   | Absolute profit since the start of the session.                                    |
| `relativeProfit`           | Relative profit in percent since the start.                                        |
| `yearlyProfit`             | Projected yearly profit in absolute terms.                                         |
| `relativeYearlyProfit`     | Projected yearly profit in percent.                                                |
| `market`                   | Market movement (start price vs end price) in percent.                             |
| `alpha`                    | Strategy outperformance vs market.                                                 |
| `sharpe`                   | Sharpe ratio based on total return volatility.                                     |
| `sortino`                  | Sortino ratio, which only penalizes downside volatility from losing trades.        |
| `standardDeviation`        | Standard deviation of trade profits, used to measure volatility.                   |
| `exposure`                 | % of time the strategy was in a trade.                                             |
| `downside`                 | Measure of downside risk based on losing trades.                                   |
| `trades`                   | Number of trades executed.                                                         |
| `ratioRoundTrips`          | % of roundtrips that were profitable. Returns `null` when no roundtrips occurred.  |
| `topMaxAdverseExcursions`  | Top ten MAE values in descending order. Exposed as a bracketed list of percentages.|
| `startTime` / `endTime`    | Start and end timestamps of the session.                                           |
| `startPrice` / `endPrice`  | Asset price at session start and end.                                              |
| `duration`                 | Duration of the session in human-readable format.                                  |

## Roundtrip Statistics

Each `roundtrip` event carries detailed information about the trade that just closed.

| Field                 | Description                                                                           |
|-----------------------|---------------------------------------------------------------------------------------|
| `entryAt`             | Timestamp when the trade was opened.                                                  |
| `exitAt`              | Timestamp when the trade was closed.                                                  |
| `entryPrice`          | Price at entry.                                                                       |
| `exitPrice`           | Price at exit.                                                                        |
| `pnl`                 | Profit & loss in the configured currency.                                             |
| `profit`              | Profit percentage over the roundtrip.                                                 |
| `duration`            | Time the position was open.                                                           |
| `maxAdverseExcursion` | Largest drawdown from the entry price observed before closing the trade (percentage). |
