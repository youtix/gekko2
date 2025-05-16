# TMA Strategy

The **TMA** strategy uses three **Simple Moving Averages (SMA)** of different lengths to determine the current market trend. Based on their relative positions, it provides trading advice to enter long or short positions.

This triple-moving-average approach is designed to catch medium-term trends while filtering out noise from shorter-term fluctuations.

## How It Works

- The strategy calculates three SMAs:
  - A **short-term SMA** for quick responsiveness,
  - A **medium-term SMA** for smoothing,
  - A **long-term SMA** for overall trend direction.
- It interprets the trend based on their relative positions:
  - If `short > medium > long`: uptrend → **long** advice.
  - If `short < medium` and `medium > long`: downtrend → **short** advice.
  - If `short > medium` and `medium < long`: also considered **short** (cut a long position).
- If none of these conditions are met, it considers the market trend unclear and takes no action.

## Configuration Parameters

```yaml
strategy:
  name: TMA

  short: 5     # Short-term SMA period
  medium: 10   # Medium-term SMA period
  long: 20     # Long-term SMA period
```

## Parameter Details

| Parameter   | Type   | Description                                 |
|-------------|--------|---------------------------------------------|
| `short`     | number | Number of candles for the short-term SMA.   |
| `medium`    | number | Number of candles for the medium-term SMA.  |
| `long`      | number | Number of candles for the long-term SMA.    |

## Notes

- Shorter periods make the SMA more responsive to recent price movements.
- Longer periods provide greater smoothing but increase lag.
- This strategy is simple yet effective in capturing sustained price movements and avoiding small fluctuations.

## Summary

The TMA strategy is a straightforward trend-following approach that identifies momentum shifts by analyzing the alignment of short, medium, and long SMAs. It is suitable for traders seeking clear and logical entry points based on consistent moving average behavior.