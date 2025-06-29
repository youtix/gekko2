# CCI Strategy

The **CCI** strategy uses the Commodity Channel Index oscillator to detect when the market becomes overbought or oversold. It issues trading advice only after these conditions persist for a configurable number of candles, filtering out brief spikes.

## How It Works

- Calculates the CCI over a user-defined period.
- When the CCI rises above the `up` threshold for `persistence` consecutive candles, it triggers a **short** advice.
- When the CCI falls below the `down` threshold for the required persistence, it triggers a **long** advice.
- If the CCI stays between the thresholds, no advice is emitted.

## Configuration Parameters

```yaml
strategy:
  name: CCI

  period: 20            # Number of candles for CCI calculation

  thresholds:
    up: 100             # Above this level is considered overbought
    down: -100          # Below this level is considered oversold
    persistence: 2      # Candles CCI must stay above/below before advising
```

## Parameter Details

| Parameter                | Type   | Description                                      |
|--------------------------|--------|--------------------------------------------------|
| `period`                 | number | Lookback period for CCI calculation.             |
| `thresholds.up`          | number | Level considered overbought.                     |
| `thresholds.down`        | number | Level considered oversold.                       |
| `thresholds.persistence` | number | Consecutive candles required to confirm a trend. |

## Notes

- Larger `persistence` values reduce noise but may delay signals.
- Adjust the threshold levels depending on market volatility.

## Summary

The CCI strategy offers a straightforward way to trade potential reversals by monitoring extreme CCI readings. It only acts after the signal persists, helping avoid reacting to short-lived moves.
