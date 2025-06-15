# Backtest

Gekko is capable of backtesting strategies against historical market data.

## Historical Data

Gekko requires historical data to run backtests. The easiest way to obtain this data is by letting Gekko import it directly. However, this method is not supported by many exchanges (see [here](../introduction/supported-exchanges.md)).

A more universal approach is to run Gekko on live markets using [**realtime**](./realtime.md) mode along with the [candleWriter](../plugins/candle-writer.md) plugin. Keep in mind this takes time—if you want a week of data, you need to run Gekko continuously for a week.

## Setup

To run backtests, you should [enable and configure](../plugins/introduction.md) the following plugins:

- [Trading Advisor](../plugins/trading-advisor.md) – to execute your strategy.
- [Paper Trader](../plugins/paper-trader.md) – to simulate trades.
- [Performance Analyzer](../plugins/performance-analyzer.md) – to evaluate the performance of your strategy.

Additionally, make sure to configure the `watch`, `storage`, and `strategy` sections of your configuration file.

You can define a specific date range for the backtest using `watch.daterange`, or use `watch.scan` to let Gekko automatically scan your local database for available date ranges:

```yaml
watch:
  asset: BTC
  currency: USDT
  mode: backtest
  scan: true
```

If you already know the exact date range you want to backtest against, use the `daterange` option:

```yaml
watch:
  asset: BTC
  currency: USDT
  mode: backtest
  daterange:
    start: '2024-01-01T00:00:00.000Z'
    end: '2024-02-01T00:00:00.000Z'
```

Then, set the `GEKKO_CONFIG_FILE_PATH` environment variable to tell Gekko where to find the configuration file. This can be done in your environment or in a `.env` file:

```bash
# .env
GEKKO_LOG_LEVEL=info
GEKKO_CONFIG_FILE_PATH=./config/backtest.yml
```

## Configuration file example

```yaml
# ./config/backtest.yml
watch:
  asset: BTC
  currency: USDT
  mode: backtest
  daterange:
    start: '2024-01-01T00:00:00.000Z'
    end: '2024-02-01T00:00:00.000Z'

storage:
  type: sqlite
  database: ./db/gekko.sql

strategy:
  name: DEMA
  period: 12
  thresholds:
    up: 100
    down: -150

plugins:
  - name: TradingAdvisor
    strategyName: DEMA
    timeframe: '1d'
    historySize: 5

  - name: PaperTrader
    reportInCurrency: true # report the profit in the currency or the asset?
    simulationBalance: # start balance, on what the current balance is compared with
      # these are in the unit types configured in the watcher.
      asset: 0
      currency: 1000
    # how much fee in % does each trade cost?
    feeMaker: 0.15
    feeTaker: 0.25
    feeUsing: maker
    slippage: 0.05 # how much slippage/spread should Gekko assume per trade?

  - name: PerformanceAnalyzer
    riskFreeReturn: 5
```

## Run

    bun gekko

You should see output similar to this:

```
  ______   ________  __    __  __    __   ______          ______
 /      \ /        |/  |  /  |/  |  /  | /      \        /      \
/$$$$$$  |$$$$$$$$/ $$ | /$$/ $$ | /$$/ /$$$$$$  |      /$$$$$$  |
$$ | _$$/ $$ |__    $$ |/$$/  $$ |/$$/  $$ |  $$ |      $$____$$ |
$$ |/    |$$    |   $$  $$<   $$  $$<   $$ |  $$ |       /    $$/
$$ |$$$$ |$$$$$/    $$$$$  \  $$$$$  \  $$ |  $$ |      /$$$$$$/
$$ \__$$ |$$ |_____ $$ |$$  \ $$ |$$  \ $$ \__$$ |      $$ |_____
$$    $$/ $$       |$$ | $$  |$$ | $$  |$$    $$/       $$       |
 $$$$$$/  $$$$$$$$/ $$/   $$/ $$/   $$/  $$$$$$/        $$$$$$$$/

{"level":"info","message":"Gekko version: v0.1.0, Bun version: v22.6.0","timestamp":"2025-03-24T22:30:34.977Z"}
{"level":"info","message":"Using the strategy: DEMA","timestamp":"2025-03-24T22:30:34.984Z"}
{"level":"warn","message":"WARNING: BACKTESTING FEATURE NEEDS PROPER TESTING","timestamp":"2025-03-24T22:30:35.018Z"}
{"level":"warn","message":"WARNING: ACT ON THESE NUMBERS AT YOUR OWN RISK!","timestamp":"2025-03-24T22:30:35.018Z"}
{"level":"info","message":"Launching backtest on BTC/USDT from 2024-01-01T00:00:00.000Z -> to 2024-02-01T00:00:00.000Z using DEMA strategy","timestamp":"2025-03-24T22:52:11.307Z"}
{"level":"info","message":"Executing short advice due to detected downtrend: @ 43111.10000000 (42868.78797/-161.98797)","timestamp":"2025-03-24T22:30:35.064Z"}
...
```
