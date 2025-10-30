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

The **PerformanceAnalyzer** plugin emits a `performanceReport` event with consolidated performance metrics when the run finishes.


## Metrics Calculated

Here are the metrics reported in the `performanceReport` event:

| Metric                 | Description                                                                        |
|------------------------|------------------------------------------------------------------------------------|
| `balance`              | Current portfolio balance in the configured currency (mark-to-market at the end). |
| `profit`               | Absolute profit since the start of the session.                                    |
| `relativeProfit`       | Relative profit in percent since the start.                                        |
| `yearlyProfit`         | Projected yearly profit in absolute terms.                                         |
| `relativeYearlyProfit` | Projected yearly profit in percent.                                                |
| `market`               | Market movement (start price vs end price) in percent.                             |
| `alpha`                | Strategy outperformance vs market.                                                 |
| `sharpe`               | Sharpe ratio based on balance-change volatility between trades.                    |
| `sortino`              | Sortino ratio, penalising only downside volatility from losing samples.            |
| `standardDeviation`    | Standard deviation (in %) of balance changes after each completed trade.           |
| `exposure`             | % of time the strategy was exposed (asset position size above zero).               |
| `downside`             | Expected downside derived from losing balance changes.                             |
| `trades`               | Number of trades executed.                                                         |
| `startTime` / `endTime`| Start and end timestamps of the session.                                           |
| `startPrice` / `endPrice`| Asset price at session start and end.                                            |
| `duration`             | Duration of the session in human-readable format.                                  |
