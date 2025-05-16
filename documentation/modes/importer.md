# Importer

If you want to use Gekko to [backtest against historical data](./backtest.md), you’ll first need historical data to test against. Gekko includes functionality to automatically import historical data from certain exchanges. However, only a few exchanges support this. You can check which exchanges are supported [here](../introduction/supported-exchanges.md).

## Architecture

![image](https://github.com/user-attachments/assets/9720cc8c-d2a7-445e-86fa-08ad2f2649f7)

## Setup

To import data, you should [enable and configure](../plugins/introduction.md) the following plugin:

- [Candle Writer](../plugins/candle-writer.md) – stores the imported data into a database.

In addition, make sure to properly configure the `watch`, `broker`, and `storage` properties.

Specify the date range you want to import using the `watch.daterange` property:

```yaml
watch:
  asset: BTC
  currency: USDT
  mode: importer
  fillGaps: empty
  daterange:
    start: '2024-01-01T00:00:00.000Z'
    end: '2024-02-01T00:00:00.000Z'
```

## Filling missing candles

Sometimes, exchanges return incomplete historical data with missing candles. To fill those gaps, Gekko provides a fillGaps option:

```yaml
watch:
  fillGaps: empty
```

Available values:
- no (default): Do not fill missing candles.
- empty: Fill gaps by inserting synthetic (empty) candles, duplicating the previous candle with adjusted timestamps.

This option ensures smoother datasets and more reliable backtesting when dealing with incomplete data from the exchange.

## Environment variables

Gekko requires the `GEKKO_CONFIG_FILE_PATH` environment variable to locate and load your configuration file. You can define it either directly in your environment or in a `.env` file:

```bash
# .env
GEKKO_LOG_LEVEL=info
GEKKO_CONFIG_FILE_PATH=./config/importer.yml
```

## Configuartion file example

```yaml
# ./config/importer.yml
watch:
  asset: BTC
  currency: USDT
  mode: importer
  fillGaps: empty
  daterange:
    start: '2024-01-01T00:00:00.000Z'
    end: '2024-02-01T00:00:00.000Z'

broker:
  name: binance

storage:
  type: sqlite
  database: ./db/gekko.sql

plugins:
  - name: CandleWriter
```

## Run

    bun gekko

You should see output similar to the following:

```
  _____   ________  __    __  __    __   ______          ______
 /      \ /        |/  |  /  |/  |  /  | /      \        /      \
/$$$$$$  |$$$$$$$$/ $$ | /$$/ $$ | /$$/ /$$$$$$  |      /$$$$$$  |
$$ | _$$/ $$ |__    $$ |/$$/  $$ |/$$/  $$ |  $$ |      $$____$$ |
$$ |/    |$$    |   $$  $$<   $$  $$<   $$ |  $$ |       /    $$/
$$ |$$$$ |$$$$$/    $$$$$  \  $$$$$  \  $$ |  $$ |      /$$$$$$/
$$ \__$$ |$$ |_____ $$ |$$  \ $$ |$$  \ $$ \__$$ |      $$ |_____
$$    $$/ $$       |$$ | $$  |$$ | $$  |$$    $$/       $$       |
  $$$$$$/  $$$$$$$$/ $$/   $$/ $$/   $$/  $$$$$$/        $$$$$$$$/

{"level":"info","message":"Gekko version: v0.1.0, Bun version: v22.6.0","timestamp":"2025-03-24T15:26:06.646Z"}
{"level":"info","message":"Importing data from 2024-01-01T00:00:00.000Z to 2024-02-01T00:00:00.000Z (1 month)","timestamp":"2025-03-24T15:26:06.693Z"}
(...)
```
