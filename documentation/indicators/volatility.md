# Volatility Indicators

Volatility indicators measure the rate and magnitude of price fluctuations in the market. They help traders assess the level of risk, identify breakout opportunities, and determine when markets may shift from trending to ranging conditions (or vice versa).

These indicators are especially useful for adjusting position sizing, setting stop-loss levels, or avoiding trades during high-risk periods.

Common volatility indicators include Bollinger Bands, Average True Range (ATR), Keltner Channels, and Chandelier Exit.

## **TrueRange**

True Range is the raw measure of volatility, calculated as the greatest of:
- Current high minus current low
- Absolute value of current high minus previous close
- Absolute value of current low minus previous close


## **ATR (Average True Range)**
ATR measures market volatility by averaging the true range over a specified number of periods. While it doesn’t indicate trend direction, it helps assess how volatile a market is.
ATR is simply a smoothed version of True Range.

## **ATRCD (ATR Convergence Divergence)**
ATR Convergence Divergence takes two ATR values of different lengths and
compares them to reveal changes in volatility momentum. The difference
between the fast and slow ATRs is smoothed with another EMA to create a
signal line, while the histogram shows how far the ATRCD line is from
this signal. Rising values indicate increasing volatility relative to the
recent trend, while falling values suggest contracting volatility.

## **Bollinger Bands**
Bollinger Bands consist of a moving average (usually SMA) and two bands plotted at a specified number of standard deviations above and below the moving average. The bands expand during periods of high volatility and contract during periods of low volatility. Bollinger Bands help identify overbought and oversold conditions, as well as potential breakout opportunities when price moves outside the bands.

---

More volatility indicators will be introduced in future releases.