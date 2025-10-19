# Plugins

Gekko currently includes several plugins to extend its functionality:

- [Candle Writer](./candle-writer.md) – writes candle data to the database.
- [Paper Trader](./paper-trader.md) – simulates trades using your strategy.
- [Performance Analyzer](./performance-analyzer.md) – evaluates the performance of your strategy.
- [EventSubscriber](./event-subscriber.md) – subscibe to Gekko events and send them to a Telegram chat group.
- [Supervision](./supervision.md) – monitor Gekko via Telegram commands.
- [Trader](./trader.md) – executes advice from the [Trading Advisor](./trading-advisor.md) on a real exchange.
- [Trading Advisor](./trading-advisor.md) – runs your trading strategy and generates advice.

To configure a plugin, open your configuration file in a text editor and define the appropriate section for each plugin you want to enable.

## Plugin section example

```yaml
plugins:
  - name: 'TradingAdvisor'
    strategyName: 'DEMA'
  
  - name: 'Trader'

  - name: 'PerformanceAnalyzer'
    riskFreeReturn: 5

  - name: EventSubscriber
    token: # Your telgram token
    botUsername: # Your telegram bot username
```
