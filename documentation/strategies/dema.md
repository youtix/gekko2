# DEMA Strategy

The **DEMA** strategy uses **Double Exponential Moving Average (DEMA)** and **Simple Moving Average (SMA)** crossovers to determine the current market trend. Based on this trend, it issues trading advice: either to enter a long (buy) or short (sell) position.

This strategy is popular in the Bitcoin trading community thanks to Bitcointalk user *Goomboo*. You can read more about this strategy on [his forum post](https://bitcointalk.org/index.php?topic=60501.0) or in [this article](http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:moving_averages).

```
⚠️ Warning: This is not a MACD strategy.
It simply measures the difference between a fast-moving average and a slower one, comparing the difference against user-defined thresholds.
```

## How It Works

- The strategy compares a **DEMA** (fast) and a **SMA** (slow).
- If the DEMA crosses significantly above the SMA, it considers the market to be in an **uptrend** and issues a `long` advice.
- If the DEMA crosses significantly below the SMA, it considers the market to be in a **downtrend** and issues a `short` advice.
- The strategy avoids triggering on minor noise by requiring the difference between the two moving averages to exceed a defined threshold.

## Configuration Parameters

```yaml
strategy:
  name: DEMA
  period: 10

  thresholds:
    up: 25    # Trigger long when (SMA - DEMA) > 25
    down: -25 # Trigger short when (SMA - DEMA) < -25
```

## Parameter Details

| Parameter         | Type    | Description                                                             |
|-------------------|---------|-------------------------------------------------------------------------|
| `period`          | number  | Number of candles used to calculate both DEMA and SMA.                  |
| `thresholds.up`   | number  | Minimum positive difference between SMA and DEMA to trigger a `long`.   |
| `thresholds.down` | number  | Maximum negative difference between SMA and DEMA to trigger a `short`.  |


## Notes

- A higher period value smooths both averages but increases lag.
- A higher threshold makes the strategy more selective and avoids reacting to small fluctuations.
- You can monitor the strategy behavior through the logs by enabling debug mode.