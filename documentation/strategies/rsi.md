# RSI Strategy

The **RSI** strategy uses the Relative Strength Index oscillator to detect overbought and oversold conditions. It issues trading advice once a trend persists for a configurable number of candles.

## How It Works

- The strategy calculates an RSI value over a configurable period.
- If RSI rises above the `high` threshold for a number of consecutive candles (`persistence`), it triggers a **short** advice.
- If RSI falls below the `low` threshold for the required persistence, it triggers a **long** advice.
- When RSI is between the thresholds, no advice is emitted.

## Configuration Parameters

```yaml
strategy:
  name: RSI

  period: 14        # Number of candles for RSI calculation
  src: close        # Price source for RSI

  thresholds:
    high: 70        # Above this value is considered overbought
    low: 30         # Below this value is considered oversold
    persistence: 2  # Candles RSI must stay above/below before advising
```

## Parameter Details

| Parameter                | Type    | Description                                   |
|--------------------------|---------|-----------------------------------------------|
| `period`                 | number  | RSI lookback period.                          |
| `src`                    | string  | Candle value used for calculation.            |
| `thresholds.high`        | number  | Level considered overbought.                  |
| `thresholds.low`         | number  | Level considered oversold.                    |
| `thresholds.persistence` | number  | Consecutive candles required to confirm trend |

## Notes

- Increasing `persistence` filters out short-lived spikes.
- Adjust the high/low levels depending on market volatility.

## Summary

The RSI strategy provides a simple momentum-based approach that acts only when overbought or oversold conditions persist. It is useful for spotting potential reversals while avoiding whipsaws caused by single candle movements.
