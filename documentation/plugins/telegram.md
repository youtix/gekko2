# Telegram Plugin

The **Telegram** plugin sends real-time notifications about important trading events directly to your Telegram chat. This includes updates on:

- Strategy advice
- Order initiation and execution
- Order cancellations, errors, or rejections
- Completed roundtrips

It acts as a simple alerting layer, helping you stay informed about your bot's activity even when you're away from your terminal.

You can also use this plugin as a lightweight **screener** to notify you when certain market conditions are met, based on your strategy's advice (e.g., “buy” or “sell” signals across multiple pairs).

```
💡 Note:
You need a valid Telegram bot token and a chat ID to use this plugin.
Learn how to create a Telegram bot and get your chat ID [here](https://core.telegram.org/bots).
```

## Configuration

To enable the **Telegram** plugin, add it to your `plugins` section in the config file:

```yaml
plugins:
  - name: Telegram                      # Must be set to "Telegram"
    token: "<your-telegram-bot-token>"  # Your Telegram bot token
    chatId: "<your-chat-id>"            # Your Telegram chat ID
```
## Events Emitted

The **Telegram** plugin does not emit any custom events.  
Its role is to **listen to trading events** emitted by other plugins (like `Trader`, `PaperTrader`, `PerformanceAnalyzer`, etc.) and send formatted messages to a Telegram chat.

It acts purely as a consumer of events and never produces new ones within the Gekko event system.


## Events Handled

The **Telegram** plugin listens to a variety of events in order to send notifications directly to your Telegram chat.

| Event                  | Description                                                                |
|------------------------|----------------------------------------------------------------------------|
| `processOneMinuteCandle`        | Updates the current price based on incoming candle data.                   |
| `onStrategyAdvice`             | Sends a message when new advice is received from a strategy.               |
| `onTradeInitiated`     | Notifies when a trade is about to be placed.                               |
| `onTradeCompleted`     | Sends detailed info once a trade is successfully executed.                 |
| `onTradeAborted`       | Sends a message when a trade is aborted due to portfolio constraints.      |
| `onTradeCanceled`      | Notifies when a pending trade is canceled before execution.                |
| `onTradeErrored`       | Reports an error that occurred during trade execution.                     |
| `onRoundtrip`          | Sends a summary when a roundtrip (buy → sell) is completed.                |

## Plugin Limitations

- The Telegram plugin is **read-only**: it does not influence or control trades, it only reports events.
- It requires a **valid bot token** and **chat ID** from Telegram. If either is invalid or missing, messages will not be delivered.
- Message delivery depends on Telegram's API availability. Network issues or API limits may prevent some messages from being sent.
- It does **not store historical messages**—once sent (or failed), messages are not retried or logged internally.
- The plugin assumes a **realtime mode**; it is not designed for use in importer or backtest modes.

