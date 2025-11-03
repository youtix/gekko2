# Backtest

Gekko is capable of backtesting strategies against historical market data.

## Historical Data

Gekko requires historical data to run backtests. The easiest way to obtain this data is by letting Gekko import it directly. However, this method is not supported by many exchanges (see [here](../introduction/supported-exchanges.md)).

A more universal approach is to run Gekko on live markets using [**realtime**](./realtime.md) mode along with the [candleWriter](../plugins/candle-writer.md) plugin. Keep in mind this takes time—if you want a week of data, you need to run Gekko continuously for a week.

## Setup

To run backtests, you should [enable and configure](../plugins/introduction.md) the following plugins:

- [Trading Advisor](../plugins/trading-advisor.md) – to execute your strategy.
- [Trader](../plugins/trader.md) – configure it with the dummy exchange to simulate trades.
- [Performance Analyzer](../plugins/performance-analyzer.md) – to evaluate the performance of your strategy.

Additionally, make sure to configure the `watch`, `storage`, and `strategy` sections of your configuration file.

You can define a specific date range for the backtest using `watch.daterange`:

```yaml
watch:
  asset: BTC
  currency: USDT
  mode: backtest
  timeframe: '1d' # default is '1m'
  warmup:
    candleCount: 365 # 0 disables warmup
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

exchange:
  name: dummy-cex

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

  - name: Trader

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

### Listing available date ranges

If you want to inspect which ranges are available in your SQLite database before running a backtest, invoke Gekko with the `--list-dateranges` flag:

```
gekko2 --list-dateranges
```

Gekko will read the configured database connection and output each contiguous range of candles, for example:

```
Available date ranges:
-> 2017-08-17T00:00:00.000Z - 2017-12-31T23:59:59.999Z
-> 2018-08-17T00:00:00.000Z - 2018-12-31T23:59:59.999Z
-> 2019-08-17T00:00:00.000Z - 2019-12-31T23:59:59.999Z
```
