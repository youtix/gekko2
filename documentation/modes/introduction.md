## Modes

Gekko is a tool that makes it easy to automate your own trading strategies.

You can either create a custom trading strategy or start with one of the built-in example strategies. Once you have a strategy, Gekko allows you to run it in several different modes:

- [**Importer**](./importer.md): Import historical market data from supported exchanges.
- [**Backtest**](./backtest.md): Simulate your strategy over a historical dataset to evaluate how it would have performed (including executed trades, profit/loss, and risk metrics).
- [**Realtime**](./realtime.md): Run the strategy on live market data by connecting the Trader plugin to different exchange setups:
  - **Dummy exchange**: Simulate trades locally with fake money while the Trader plugin routes orders to `dummy-cex`.
  - **Sandbox**: Test your strategy using an exchange-provided testnet with sandbox API keys.
  - **Live exchange**: Place real orders on a funded exchange account using live API credentials.
