# Trading Advisor Plugin

The **Trading Advisor** plugin is responsible for running a trading strategy in Gekko and emitting trading advice based on historical or real-time market data. It can be used in [realtime mode](../modes/realtime.md) or [backtest mode](../modes/backtest.md).

> ⚠️ Note: This is not the same as the [Trader](./trader.md) plugin, which executes real orders on an exchange. If you want fully automated trading, you need to configure **both** the Trading Advisor (to generate advice) and the Trader plugin (to act on that advice).

Documentation about how to create or configure strategies in Gekko can be found [here](../strategies/introduction.md).

## Configuration

In your configuration file, under the `plugins` section, you can configure the Trading Advisor plugin like this:

```yaml
plugins:
  - name: TradingAdvisor # Must be set to TradingAdvisor.
    strategyName: DEMA # Name of the strategy to run (same as strategy section).
```

The candle `timeframe` and optional warm‑up settings are now defined under the `watch` section. `timeframe` defaults to `'1m'` and must be one of the following values:

`'1m'`, `'2m'`, `'3m'`, `'5m'`, `'10m'`, `'15m'`, `'30m'`, `'1h'`, `'2h'`, `'4h'`, `'6h'`, `'8h'`, `'12h'`, `'1d'`, `'1w'`, `'1M'`, `'3M'`, `'6M'`, `'1y'`.

## Events Emitted

The Trading Advisor emits several events, which can be consumed by other plugins:

| Event                        | Description                                                                 |
|------------------------------|-----------------------------------------------------------------------------|
| `advice`                     | Emitted when the strategy detects a trading signal (e.g., long or short).   |
| `strategyCandle`             | Emitted when a new aggregated candle is generated and sent to the strategy. |
| `strategyUpdate`             | Emitted after each candle with current indicator values.                    |
| `strategyWarmupCompleted`    | Emitted once the strategy has received enough candles to start advising.    |
| `tradeCompleted`             | Emitted when a trade advice is confirmed and executed.                      |

These events are emitted through a deferred mechanism and then broadcast through Gekko’s main event bus.
