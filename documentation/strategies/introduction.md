# Strategies

In Gekko, a **strategy** is a trading algorithm that analyzes price data and makes decisions about when to buy or sell. Strategies rely on technical indicators and are designed to emit **advice**: either to go `long` (buy) or `short` (sell).

Strategies are the core of Gekko’s decision-making process, and they run on every candle received from the market.

## What does a strategy do?

At its core, a strategy:

- Receives new market candles in real time or during backtesting.
- Runs indicators to interpret the market.
- Makes decisions based on predefined logic.
- Emits advice (`long`, `short`).
- Reacts to trades once they’re executed (via broker or simulation).
- Optionally logs or notifies events for debugging or visualization.

```
💡 Note:
Strategies **do not execute trades directly**.
Instead, they emit advice events that are consumed by other plugins (like Trader or PaperTrader).
```

## Available Strategies

Below you can find simple and exemplary strategies that come with Gekko. These strategies come with Gekko and serve as examples.

Gekko currently comes with the following example strategies:
- [DEMA](./dema.md)
- [MACD](./macd.md)
- [TMA](./tma.md)
- [RSI](./rsi.md)
- [CCI](./cci.md)

More strategies will be available in future releases.

## Using External Strategies

Gekko can load strategies from any JavaScript or TypeScript file. Provide the
`strategyPath` in the Trading Advisor configuration to point to a module that
exports your strategy class and specify its `strategyName`.


