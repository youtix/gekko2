# MACD Strategy

The **MACD** strategy uses the **Moving Average Convergence Divergence (MACD)** indicator to detect and confirm market trends. It issues trading advice (long or short) only when a trend is **persisting**, helping to filter out short-lived fluctuations and reduce false signals.

> 📘 This is a traditional MACD-based strategy, relying on the MACD line strength relative to configurable thresholds, and requires the signal to **persist** over a number of candles before acting.

## How It Works

- The strategy calculates a MACD line from the difference between two exponential moving averages (EMAs), and also tracks its signal line and histogram.
- It waits for the MACD value to rise above or fall below user-defined thresholds.
- A **trend direction** (up or down) is only considered valid if the MACD value exceeds its threshold for a **minimum number of candles** (persistence).
- Once a valid uptrend or downtrend has persisted, it advises a **long** or **short** trade respectively.

## Configuration Parameters

```yaml
strategy:
  name: MACD

  short: 12        # Short EMA period
  long: 26         # Long EMA period
  signal: 9        # Signal line EMA period

  thresholds:
    up: 0.025      # Trigger long when MACD > 0.025 (after persistence)
    down: -0.025   # Trigger short when MACD < -0.025 (after persistence)
    persistence: 3 # Number of candles MACD must stay above/below threshold before advising
```

## Parameter Details

| Parameter                 | Type    | Description                                                                 |
|---------------------------|---------|-----------------------------------------------------------------------------|
| `short`                   | number  | Number of periods for the fast EMA.                                        |
| `long`                    | number  | Number of periods for the slow EMA.                                        |
| `signal`                  | number  | Number of periods for the signal line EMA.                                 |
| `thresholds.up`           | number  | Minimum MACD value to trigger an uptrend.                                  |
| `thresholds.down`         | number  | Maximum MACD value to trigger a downtrend.                                 |
| `thresholds.persistence`  | number  | Number of consecutive candles required to confirm the trend direction.     |

## Notes

- This strategy helps filter out false positives by requiring **confirmation over time**.
- The MACD thresholds should be adjusted based on the volatility of the market you're trading.
- You can view intermediate MACD, signal, and histogram values using the debug logs.

## Summary

The MACD strategy is ideal for traders looking to **follow confirmed trends** rather than reacting immediately to every signal crossover. It's especially useful in **volatile or sideways markets** where quick reversals are common.