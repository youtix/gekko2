# Paper trader Plugin

The **PaperTrader** plugin simulates live trading without placing any real orders on an exchange. It listens to the advice from the [Trading Advisor](./trading-advisor.md) and updates a simulated portfolio based on that advice.

When the strategy advises a **long**, the PaperTrader converts all the simulated currency into assets using the current price. When it advises a **short**, it does the opposite—converting all assets back into currency.

This is useful for:

- Testing strategies in live markets without risking real money.
- Measuring the performance of a strategy in real-time / backtest mode.
- Comparing different strategy outcomes with configurable fees, slippage, and balances.

The PaperTrader plugin is fully compatible with triggers such as trailing stops, allowing it to simulate more advanced trading behavior (e.g. exiting long positions with a trailing stop loss).


## Configuration

In your configuration file, under the `plugins` section, you can configure the Paper Trader plugin like this:

```yaml
plugins:
  - name: PaperTrader # Must be set to PaperTrader
    reportInCurrency: true # Report profits in the currency (e.g., USDT) instead of the asset
    simulationBalance:
      asset: 1 # Starting simulated asset balance (e.g., BTC)
      currency: 100 # Starting simulated currency balance (e.g., USDT)
    feeMaker: 0.5 # Maker fee in percent (e.g., 0.5%)
    feeTaker: 0.6 # Taker fee in percent (e.g., 0.6%)
    feeUsing: maker # Which fee to apply ("maker" or "taker")
    slippage: 0.1 # Simulated slippage per trade (in percent)

```

```
💡 Note:
Make sure to set realistic slippage and fees, especially if you plan to use Paper Trader for performance evaluation.
Unrealistic values can lead to inaccurate results.
```

## Events Emitted

The **PaperTrader** plugin emits several events during the simulation of trades. These events allow other parts of the Gekko system (like logging, analytics, or UI) to track simulated portfolio changes and trade outcomes.

| Event                          | Description                                                                |
|--------------------------------|----------------------------------------------------------------------------|
| `TRADE_INITIATED_EVENT`        | Emitted when a simulated trade is about to be executed.                    |
| `TRADE_COMPLETED_EVENT`        | Emitted when a simulated trade has been successfully completed.            |
| `PORTFOLIO_CHANGE_EVENT`       | Emitted when the simulated portfolio (asset or currency) changes.          |
| `PORTFOLIO_VALUE_CHANGE_EVENT` | Emitted when the total simulated portfolio value changes.                  |
| `TRIGGER_CREATED_EVENT`        | Emitted when a trailing stop trigger is created.                           |
| `TRIGGER_FIRED_EVENT`          | Emitted when a trailing stop trigger condition is met and executes.        |
| `TRIGGER_ABORTED_EVENT`        | Emitted when an active trigger is canceled due to a new incoming advice.   |
