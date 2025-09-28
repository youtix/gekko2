# PerformanceReporter Plugin

The **PerformanceReporter** plugin saves a structured CSV log of each completed backtest run's performance report.
It is ideal for strategy researchers and quant developers who want to automatically collect key backtest metrics over time, such as profit, Sharpe ratio, Sortino ratio, number of trades, etc.

By storing the results in a single CSV file, it enables batch testing and comparison workflows without needing manual copy-paste or screenshotting Gekko outputs.

```
💡 Note:
This plugin is only supported in "backtest" mode.
```

## Configuration

To enable the **PerformanceReporter** plugin, add it to your `plugins` section in the config file:

```yaml
plugins:
  - name: PerformanceReporter       # Must be set to "PerformanceReporter"
    filePath: "./results"           # Optional: directory where the CSV will be saved (default = current folder)
    fileName: "report.csv"          # Optional: CSV filename (default = "performance_reports.csv")
```

If the file or folder does not exist, the plugin will automatically create them at startup.

## CSV Columns

Each row in the CSV contains the following metrics:

| Column                  | Description                                                                                     |
|-------------------------|-------------------------------------------------------------------------------------------------|
| `id`                    | ID of the strategy                                                                              |
| `pair`                  | The name of the pair                                                                            |
| `startTime`             | Timestamp when the backtest started                                                             |
| `endTime`               | Timestamp when the backtest ended                                                               |
| `duration`              | Total runtime of the strategy                                                                   |
| `exposure`              | % of time the strategy was in a position                                                        |
| `startPrice`            | Price at the beginning of the simulation                                                        |
| `endPrice`              | Price at the end of the simulation                                                              |
| `market`                | Performance of the underlying market (i.e., return from a simple buy-and-hold strategy)         |
| `alpha`                 | Strategy alpha (raw edge over the market)                                                       |
| `simulatedYearlyProfit` | Annualized profit estimation based on performance                                               |
| `amountOfTrades`        | Number of trades executed                                                                       |
| `originalBalance`       | Starting portfolio balance                                                                      |
| `currentBalance`        | Final portfolio balance                                                                         |
| `sharpeRatio`           | Risk-adjusted return metric that considers both upside and downside volatility                  |
| `sortinoRatio`          | Risk-adjusted return metric that only considers downside volatility                             |
| `standardDeviation`     | Standard deviation of trade profits, used to measure volatility                                 |
| `expectedDownside`      | Worst-case loss estimate                                                                        |
| `ratioRoundtrip`        | Ratio of trades that completed a full buy/sell cycle                                            |
| `topMaeList`            | Bracketed list string of up to ten worst MAE percentages (descending order)                     |

## Events Emitted

The **PerformanceReporter** plugin does not emit any events.  
It acts purely as a file writer.

## Events Handled

| Event                 | Description                                                                          |
|-----------------------|--------------------------------------------------------------------------------------|
| `onPerformanceReport` | Captures the final performance summary from backtests and appends it to the CSV file |

## Plugin Limitations

- Only works in **backtest mode**. It does not support live or paper trading.
- It is a **passive consumer**—it does not modify strategy behavior.
- If the target file is open in Excel or locked by another process, writes may fail.
- The CSV log is **append-only**. It does not deduplicate or check for repeated reports.