# About Gekko

**Gekko** is an open-source trading bot and backtesting platform that allows you to automate your trading strategies on cryptocurrency markets. It is designed for ease of use, flexibility, and transparency. Whether you're just getting started or building complex algorithmic strategies, Gekko provides the foundation to experiment, test, and deploy your ideas.

Gekko supports multiple exchanges, strategy development, backtesting on historical data, paper trading, and live automated trading with real funds.

## Getting Started

If you're new to Gekko, check out the [Getting Started](./getting-started.md) guide to set up your environment and run your first strategy.

## Strategies

A [**strategy**](../strategies/introduction.md) in Gekko is a JavaScript class that defines how your bot reacts to market conditions. Strategies process market data (candles and indicators) and can issue **advices**: go `long` (buy) or go `short` (sell).

You can also write your own custom strategies using built-in or custom indicators. Strategies expose lifecycle methods such as `init`, `onEachCandle`, `onCandleAfterWarmup`, `log`, `end` and `onOrderExecuted` to hook into Gekko's engine.

## Indicators

[**Indicators**](../indicators/introduction.md) are the building blocks of your strategies. Gekko provides a set of commonly used technical indicators, which are grouped into categories:

- **Directional Movement**
- **Momentum**
- **Moving Averages**
- **Oscillators**
- **Volatility**
- **Volume**

You can combine multiple indicators within a strategy and configure their parameters to fit your trading logic.

## Limitations

Gekko is a powerful tool, but it has some limitations:

- It does not support high-frequency trading or ultra-low-latency strategies.
- It is single-threaded and not optimized for large-scale production deployment.
- It does not include advanced order types beyond basic market or limit orders.
- Risk management and portfolio diversification must be implemented manually.
- Only one Trader plugin can manage orders at a time—configure it with a live exchange for real orders or the dummy exchange to simulate trades safely.

Gekko is best used for learning, prototyping, and running simple to medium complexity strategies.

## Credit

Gekko 2 is inspired by the original Gekko project created by **Mike van Rossum**, which was actively maintained by the open-source community. The original project began in 2013 and has been improved by hundreds of contributors over the years.

Special thanks to everyone who has submitted code, reported issues, or shared strategies — your contributions have been invaluable.

## Disclaimer

Gekko is **not financial advice software**. It will never guarantee profits or prevent losses.

You are solely responsible for any trades executed using this tool. Always test your strategies thoroughly using backtesting and paper trading before considering live deployment with real funds.

Use Gekko at your own risk.
