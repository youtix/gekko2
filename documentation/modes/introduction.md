## Modes

Gekko is a tool that makes it easy to automate your own trading strategies.

You can either create a custom trading strategy or start with one of the built-in example strategies. Once you have a strategy, Gekko allows you to run it in several different modes:

- [**Importer**](./importer.md): Import historical market data from supported exchanges.
- [**Backtest**](./backtest.md): Simulate your strategy over a historical dataset to evaluate how it would have performed (including executed trades, profit/loss, and risk metrics).
- [**Realtime**](./realtime.md): Run the strategy on live market data using one of three options:
  - **Paper Trader**: Simulate trades locally using fake money, based on your strategy’s signals.
  - **Sandbox**: Simulate trades using your broker's testnet environment (fake money via API).
  - **Trader**: Place real orders on a live exchange using real money, based on your strategy’s advice.
