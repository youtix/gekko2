# Supported Exchanges

Gekko can interact directly with the APIs of multiple cryptocurrency exchanges. However, the level of integration varies between exchanges. Depending on the exchange, Gekko supports the following features:

- **Monitoring**: Gekko can retrieve live market data from the exchange. This data can be stored or used to run trading strategies in real-time.
- **Sandbox**: Gekko can simulate live trading using the exchange's sandbox/testnet APIs, executing buy and sell orders based on your strategy.
- **Live Trading**: Gekko can execute real orders using live funds, transforming it into a fully automated trading bot.
- **Importing**: Gekko can download historical market data from the exchange, allowing you to backtest strategies on real past market conditions.

| Exchange      | Monitoring | Sandbox | Live Trading | Importing | Notes                                                                   |
|---------------|:----------:|:-------:|:------------:|:---------:|-------------------------------------------------------------------------|
| **Binance**   | 🟩         | 🟩      | 🟩           | 🟩        | Up to 1,000 trades per request and high trading volume. Perfect choice |
| **Bitfinex**  | 🟨         | 🟥      | 🟨           | 🟨        | Up to 10,000 trades per request, but **low trading volume** may limit data usefulness. A high tickrate is recommended. |

## Legend

- 🟩 Good  
- 🟨 To use with caution  
- 🟥 Not Supported

> 💡 **Note**:  
> More exchanges may be supported in the future. Check the official documentation or GitHub repository for the latest updates.
