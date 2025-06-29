# Volume Indicators

Volume indicators analyze the amount of trading activity over time. They are commonly used to confirm trends, identify potential reversals, and detect the strength behind price movements. When combined with price data, volume analysis can provide deeper insights into market sentiment and the validity of price signals.

Examples of widely used volume indicators include On-Balance Volume (OBV), Accumulation/Distribution Line (ADL), Money Flow Index (MFI), and Volume Weighted Average Price (VWAP).

## **EFI (Elder Force Index)**

The Elder Force Index (EFI) measures the strength behind price movements by combining price change with trading volume. The raw force value `(close - previous close) * volume` can be smoothed with a moving average (EMA by default) to reduce noise. You can choose `ema`, `sma`, `dema`, or `wma` smoothing. The indicator returns both the raw force index and the smoothed value. Positive EFI values indicate buying pressure, while negative values highlight selling pressure.

---

More volume indicators will be introduced in future releases.
