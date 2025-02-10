# Candle Writer Plugin

The **CandleWriter** plugin is responsible for storing candles during live trading or importing sessions. It listens to the market data stream and writes each incoming candle to the storage backend.

This plugin ensures that all historical candle data is properly persisted, allowing for analysis, backtesting, and review of market conditions at any time.

It performs two main tasks:

- Adds each incoming candle to the storage during execution.
- Finalizes the candle batch and closes the storage connection at the end of the session.

```
💡 Note:
- This plugin does not emit or handle any events.
- It operates silently in the background and requires the `storage` service to be injected.
- Only Sqlite is supported for the moment
```

## Configuration

In your configuration file, under the `plugins` section, you can configure the **CandleWriter** plugin like this:

```yaml
plugins:
  - name: CandleWriter # Must be set to CandleWriter.
```

The **CandleWriter** plugin does not require any additional custom parameters in the plugin block itself, but it relies on a properly configured `storage` section to configure the database:

```yaml
storage:
  adapter: sqlite       # name of SQL database engine
  database: candles.db  # path to your SQLite file database name
```

## Events Emitted

The **CandleWriter** plugin does not emit any events.

It passively listens to market data (candles) and writes them to the configured storage without broadcasting events to other plugins or systems.
