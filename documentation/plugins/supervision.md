# Supervision Plugin

The **Supervision** plugin allows basic monitoring of your running Gekko instance through Telegram commands. It relies on Gekko's internal `TelegramBot` service and does not require any external Telegram libraries.

It supports a set of commands sent from your configured chat:

- `/healthcheck` – replies whether Gekko is currently running.
- `/launchCpuCheck` – start periodic CPU usage monitoring. When the usage goes above the configured threshold, an alert is sent.
- `/launchMemoryCheck` – start periodic memory usage monitoring. When usage exceeds the threshold, an alert is sent.
- `/stopCpuCheck` – stop the CPU monitoring loop.
- `/stopMemoryCheck` – stop the memory monitoring loop.
- `/launchTimeframeCandleCheck` – check each timeframe candle against exchange data.
- `/stopTimeframeCandleCheck` – stop the timeframe candle check loop.
- `/startLogMonitoring` – send warning and error logs at a set interval.
- `/stopLogMonitoring` – stop the log monitoring loop.

``` 
💡 Note:
This plugin is designed for **realtime** mode only and uses the existing Telegram configuration (token) to send replies.
```

## Configuration

Add the **Supervision** plugin to the `plugins` section of your config file:

```yaml
plugins:
  - name: Supervision                         # Must be set to "Supervision"
    token: <your-telegram-bot-token>          # Telegram bot token
    botUsername: <your-telegram-bot-username> # Telegram bot username
    cpuThreshold: 80                          # CPU percent above which to alert
    memoryThreshold: 1024                     # Memory (MB) above which to alert
    cpuCheckInterval: 10000                   # How often to check CPU usage (ms)
    memoryCheckInterval: 10000                # How often to check memory usage (ms)
    logMonitoringInterval: 60000              # How often to check buffered logs (ms)
```

## Plugin Limitations

- Works only in **realtime** mode.
- Alerts are sent only when checks are started via Telegram commands.
- CPU and memory usage are calculated from the running process and may differ slightly from system tools.
