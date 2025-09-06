# Volume Indicators

Volume indicators analyze the amount of trading activity over time. They are commonly used to confirm trends, identify potential reversals, and detect the strength behind price movements. When combined with price data, volume analysis can provide deeper insights into market sentiment and the validity of price signals.

Examples of widely used volume indicators include On-Balance Volume (OBV), Accumulation/Distribution Line (ADL), Money Flow Index (MFI), and Volume Weighted Average Price (VWAP).

## **OBV (On-Balance Volume)**

OBV tracks cumulative buying and selling pressure by adding the volume when the close is higher than the previous close and subtracting it when the close is lower. Rising OBV values help confirm uptrends, while falling values suggest downtrends or distribution.

## **EFI (Elder Force Index)**

The Elder Force Index (EFI) measures the strength behind price movements by combining price change with trading volume. The raw force value `(close - previous close) * volume` can be smoothed with a moving average (EMA by default) to reduce noise. You can choose `ema`, `sma`, `dema`, or `wma` smoothing. The indicator returns both the raw force index and the smoothed value. Positive EFI values indicate buying pressure, while negative values highlight selling pressure.

## **Volume Delta**

Volume Delta measures the imbalance between aggressive buying and selling within each candle. For every update, `volumeDelta = active - (total - active)`, where `total` and `active` are taken from either quote or base volumes. The `src` parameter selects `'quote'` (default) or `'base'`, mapping to `quoteVolume`/`quoteVolumeActive` or `volume`/`volumeActive` respectively. Missing values are treated as `0`.

To capture momentum on the delta itself, the indicator also applies a MACD over the `volumeDelta` stream. You can configure MACD parameters via `{ short, long, signal }` (defaults: `12, 26, 9`). The result returns the raw `volumeDelta` plus the MACD fields: `macd`, `signal`, and `hist`.

---

More volume indicators will be introduced in future releases.
