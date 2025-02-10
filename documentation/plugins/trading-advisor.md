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
    candleSize: 60 # The time in minutes each candle represents (e.g., 60 = hourly candles).
    historySize: 10 # Number of candles the strategy needs before it can start generating advice. (warm-up phase)
```

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
