# EventSubscriber Plugin

The **EventSubscriber** plugin sends real-time notifications about important trading events directly to your Telegram chat. This includes updates on:

- Strategy advice
- Order initiation and execution
- Order cancellations, errors, or rejections
- Completed roundtrips

It acts as a simple alerting layer, helping you stay informed about your bot's activity even when you're away from your terminal.

You can also use this plugin as a lightweight **screener** to notify you when certain market conditions are met, based on your strategy's advice (e.g., “buy” or “sell” signals across multiple pairs).

```
💡 Note:
You need a valid Telegram bot token to use this plugin.
The chat ID is captured automatically when you send a command to your bot.
Learn how to create a Telegram bot [here](https://core.telegram.org/bots).
```

## Configuration

To enable the **EventSubscriber** plugin, add it to your `plugins` section in the config file:

```yaml
plugins:
  - name: EventSubscriber               # Must be set to "EventSubscriber"
    token: "<your-telegram-bot-token>"  # Your Telegram bot token
```
## Events Emitted

The **EventSubscriber** plugin does not emit any custom events.  
Its role is to **listen to trading events** emitted by other plugins (like `Trader`, `PaperTrader`, `PerformanceAnalyzer`, etc.) and send formatted messages to a Telegram chat.

It acts purely as a consumer of events and never produces new ones within the Gekko event system.


## Events Handled

The **EventSubscriber** plugin listens to a variety of events in order to send notifications directly to your Telegram chat.

| Event                    | Description                                                                |
|--------------------------|----------------------------------------------------------------------------|
| `processOneMinuteCandle` | Updates the current price based on incoming candle data.                   |
| `onStrategyInfo`         | Sends a message with logs from a strategy.                                 |
| `onStrategyAdvice`       | Sends a message when new advice is received from a strategy.               |
| `onTradeInitiated`       | Notifies when a trade is about to be placed.                               |
| `onTradeCompleted`       | Sends detailed info once a trade is successfully executed.                 |
| `onTradeAborted`         | Sends a message when a trade is aborted due to portfolio constraints.      |
| `onTradeCanceled`        | Notifies when a pending trade is canceled before execution.                |
| `onTradeErrored`         | Reports an error that occurred during trade execution.                     |
| `onRoundtrip`            | Sends a summary when a roundtrip (buy → sell) is completed.                |

## Commands

All commands use underscores. Subscriptions are reset when the process restarts.

### Toggle subscriptions

Each event can be toggled with `/subscribe_to_<event>`:

- `/subscribe_to_strategy_info`
- `/subscribe_to_strategy_advice`
- `/subscribe_to_trade_initiated`
- `/subscribe_to_trade_canceled`
- `/subscribe_to_trade_aborted`
- `/subscribe_to_trade_errored`
- `/subscribe_to_trade_completed`
- `/subscribe_to_roundtrip`

Sending the same command again unsubscribes from that event.

### Bulk subscription commands

- `/subscribe_to_all` – subscribe to all events.
- `/unsubscribe_from_all` – unsubscribe from all events.
- `/subscriptions` – list current subscriptions.

### Other commands

- `/help` – list all available commands.

## Plugin Limitations

- The EventSubscriber plugin is **read-only**: it does not influence or control trades, it only reports events.
- It requires a **valid bot token** from Telegram. If the bot never receives a command, it cannot detect the chat to send messages to.
- Message delivery depends on Telegram's API availability. Network issues or API limits may prevent some messages from being sent.
- Subscriptions are kept in memory and are lost when the process restarts.
- The plugin assumes a **realtime mode**; it is not designed for use in importer or backtest modes.

