# 📊 Technical Indicators

Gekko 2 provides a comprehensive library of **25+ built-in technical indicators** organized into six categories. Each indicator is optimized for performance and integrates seamlessly with strategies.

---

## Table of Contents

- [Moving Averages](#-moving-averages)
- [Momentum Indicators](#-momentum-indicators)
- [Directional Movement](#-directional-movement)
- [Oscillators](#-oscillators)
- [Volatility Indicators](#-volatility-indicators)
- [Volume Indicators](#-volume-indicators)
- [Common Parameters](#-common-parameters)
- [Using Indicators in Strategies](#-using-indicators-in-strategies)

---

## 📈 Moving Averages

Moving averages smooth price data to identify trends and potential support/resistance levels.

### SMA — Simple Moving Average

The **Simple Moving Average** calculates the arithmetic mean of prices over a specified period. All data points are weighted equally.

| Parameter | Type   | Default | Description                                                          |
|-----------|--------|---------|--------------------------------------------------------------------- |
| `period`  | number | 30      | Number of candles to average                                         |
| `src`     | string | 'close' | Price source: `open`, `high`, `low`, `close`, `hl2`, `hlc3`, `ohlc4` |

**Formula:** `SMA = Sum(Price, n) / n`

**Use Cases:**
- Identifying long-term trends
- Dynamic support and resistance levels
- Baseline for other indicators

---

### EMA — Exponential Moving Average

The **Exponential Moving Average** gives more weight to recent prices, making it more responsive to new information than the SMA.

| Parameter | Type   | Default | Description      |
|-----------|--------|---------|------------------|
| `period`  | number | 30      | Smoothing period |
| `src`     | string | 'close' | Price source     |

**Formula:** `EMA = (Price - Previous EMA) × Multiplier + Previous EMA`  
Where Multiplier = `2 / (period + 1)`

**Use Cases:**
- Faster trend identification
- Crossover strategies
- MACD calculation base

---

### DEMA — Double Exponential Moving Average

**DEMA** reduces the lag inherent in traditional moving averages by applying EMA twice and using a specific formula.

| Parameter | Type   | Default    | Description      |
|-----------|--------|------------|------------------|
| `period`  | number | *required* | Smoothing period |

**Formula:** `DEMA = 2 × EMA(Price) - EMA(EMA(Price))`

**Use Cases:**
- Reduced-lag trend following
- Faster signal generation
- Smoother price representation

---

### WMA — Weighted Moving Average

The **Weighted Moving Average** assigns linearly increasing weights to more recent prices.

| Parameter | Type   | Default    | Description      |
|-----------|--------|------------|------------------|
| `period`  | number | *required* | Smoothing period |
| `src`     | string | 'close'    | Price source     |

**Formula:** `WMA = (P₁×1 + P₂×2 + ... + Pₙ×n) / (1+2+...+n)`

**Use Cases:**
- Medium responsiveness between SMA and EMA
- Trend identification with moderate lag

---

### TEMA — Triple Exponential Moving Average

**TEMA** applies exponential smoothing three times, further reducing lag compared to DEMA.

| Parameter | Type   | Default    | Description      |
|-----------|--------|------------|----------------- |
| `period`  | number | *required* | Smoothing period |

**Formula:** `TEMA = 3×EMA₁ - 3×EMA₂ + EMA₃`

**Use Cases:**
- Minimal-lag trend following
- High-frequency trading signals
- Aggressive entry/exit timing

---

### SMMA — Smoothed Moving Average

The **Smoothed Moving Average** is a variation of EMA with a longer lookback effect, providing very smooth curves.

| Parameter | Type   | Default    | Description      |
|-----------|--------|------------|----------------- |
| `period`  | number | *required* | Smoothing period |
| `src`     | string | 'close'    | Price source     |

**Use Cases:**
- Long-term trend analysis
- Reducing noise in volatile markets

---

### Wilder Smoothing

**Wilder Smoothing** (also known as Wilder's Smoothing Method) is used in indicators like RSI and ATR. It's similar to EMA but with a different smoothing factor.

| Parameter | Type   | Default    | Description          |
|-----------|--------|------------|----------------------|
| `period`  | number | *required* | Smoothing period     |

**Use Cases:**
- Internal calculation for RSI, ATR, ADX
- Custom indicator development

---

### EMA Ribbon

The **EMA Ribbon** displays multiple EMAs with different periods simultaneously, creating a "ribbon" effect that shows trend strength and potential reversal zones.

| Parameter | Type     | Default    | Description          |
|-----------|----------|------------|----------------------|
| `periods` | number[] | *required* | Array of EMA periods |

**Use Cases:**
- Visual trend strength analysis
- Identifying trend reversals when ribbons cross
- Multi-timeframe momentum confirmation

---

## 🚀 Momentum Indicators

Momentum indicators measure the speed and strength of price movements.

### MACD — Moving Average Convergence Divergence

**MACD** is a trend-following momentum indicator showing the relationship between two EMAs. It consists of the MACD line, signal line, and histogram.

| Parameter | Type   | Default | Description            |
|-----------|--------|---------|------------------------|
| `short`   | number | 12      | Fast EMA period        |
| `long`    | number | 26      | Slow EMA period        |
| `signal`  | number | 9       | Signal line EMA period |
| `src`     | string | 'close' | Price source           |

**Output:**
- `macd` — MACD line (Fast EMA - Slow EMA)
- `signal` — Signal line (EMA of MACD)
- `hist` — Histogram (MACD - Signal)

**Trading Signals:**
- **Bullish:** MACD crosses above signal line
- **Bearish:** MACD crosses below signal line
- **Divergence:** Price making new highs/lows while MACD isn't

---

### Stochastic Oscillator

The **Stochastic Oscillator** compares a closing price to its price range over a period, showing overbought/oversold conditions.

| Parameter     | Type   | Default | Description                             |
|---------------|--------|---------|-----------------------------------------|
| `fastKPeriod` | number | 5       | Raw %K lookback period                  |
| `slowKPeriod` | number | 3       | %K smoothing period                     |
| `slowKMaType` | string | 'sma'   | %K MA type: `sma`, `ema`, `dema`, `wma` |
| `slowDPeriod` | number | 3       | %D smoothing period                     |
| `slowDMaType` | string | 'sma'   | %D MA type                              |

**Output:**
- `k` — %K line (fast stochastic)
- `d` — %D line (slow stochastic)

**Interpretation:**
- **Above 80:** Overbought — potential sell signal
- **Below 20:** Oversold — potential buy signal
- **%K crossing %D:** Momentum shift signal

---

### Stochastic RSI

**Stochastic RSI** applies the Stochastic formula to RSI values instead of price, creating a more sensitive momentum indicator.

| Parameter     | Type   | Default | Description       |
|---------------|--------|---------|-------------------|
| `lengthRsi`   | number | 14      | RSI period        |
| `lengthStoch` | number | 14      | Stochastic period |
| `smoothK`     | number | 3       | %K smoothing      |
| `smoothD`     | number | 3       | %D smoothing      |

**Output:**
- `k` — Stochastic RSI %K
- `d` — Stochastic RSI %D

**Use Cases:**
- Identifying extreme overbought/oversold conditions
- Trading range-bound markets
- Confirming trend strength

---

### PSAR — Parabolic Stop and Reverse

**Parabolic SAR** provides potential entry and exit points. The indicator appears as dots above or below the price, indicating trend direction.

| Parameter         | Type   | Default | Description                 |
|-------------------|--------|---------|-----------------------------|
| `acceleration`    | number | 0.02    | Initial acceleration factor |
| `maxAcceleration` | number | 0.2     | Maximum acceleration factor |

**Interpretation:**
- **Dots below price:** Uptrend — hold long positions
- **Dots above price:** Downtrend — hold short positions
- **Dot flip:** Potential trend reversal

**Use Cases:**
- Trailing stop placement
- Trend reversal identification
- Entry/exit timing

---

### ROC — Rate of Change

**Rate of Change** measures the percentage change in price between the current price and the price n periods ago.

| Parameter | Type   | Default    | Description     |
|-----------|--------|------------|-----------------|
| `period`  | number | *required* | Lookback period |
| `src`     | string | 'close'    | Price source    |

**Formula:** `ROC = ((Current Price - Price n periods ago) / Price n periods ago) × 100`

**Interpretation:**
- **Positive values:** Upward momentum
- **Negative values:** Downward momentum
- **Zero line crossings:** Momentum shifts

---

### TRIX

**TRIX** is a momentum oscillator that shows the percentage rate of change of a triple exponentially smoothed moving average.

| Parameter | Type   | Default | Description        |
|-----------|--------|---------|--------------------|
| `period`  | number | 15      | EMA period         |
| `signal`  | number | 9       | Signal line period |

**Output:**
- `trix` — TRIX line
- `signal` — Signal line

**Use Cases:**
- Filtering market noise
- Identifying trend reversals
- Overbought/oversold conditions

---

### Williams %R

**Williams %R** is a momentum indicator that measures overbought/oversold levels, similar to the Stochastic oscillator but inverted.

| Parameter | Type   | Default | Description     |
|-----------|--------|---------|-----------------|
| `period`  | number | 14      | Lookback period |

**Formula:** `%R = (Highest High - Close) / (Highest High - Lowest Low) × -100`

**Interpretation:**
- **-20 to 0:** Overbought — potential sell signal
- **-100 to -80:** Oversold — potential buy signal

---

## 🧭 Directional Movement

Directional movement indicators measure trend strength and direction.

### ADX — Average Directional Index

**ADX** measures trend strength regardless of direction. Higher values indicate stronger trends.

| Parameter | Type   | Default    | Description      |
|-----------|--------|------------|------------------|
| `period`  | number | *required* | Smoothing period |

**Interpretation:**
- **0-25:** Weak or no trend
- **25-50:** Strong trend
- **50-75:** Very strong trend
- **75-100:** Extremely strong trend

**Use Cases:**
- Determining if market is trending
- Filtering signals in choppy markets
- Position sizing based on trend strength

---

### ADX Ribbon

**ADX Ribbon** displays multiple ADX values across different periods, similar to an EMA ribbon but for trend strength.

| Parameter | Type     | Default    | Description              |
|-----------|----------|------------|--------------------------|
| `periods` | number[] | *required* | Array of ADX periods     |

**Use Cases:**
- Multi-timeframe trend strength analysis
- Identifying trend strength divergences

---

### DX — Directional Movement Index

**DX** is the base calculation for ADX, measuring the difference between +DI and -DI.

| Parameter | Type   | Default    | Description              |
|-----------|--------|------------|--------------------------|
| `period`  | number | *required* | Smoothing period         |

**Formula:** `DX = |+DI - -DI| / (+DI + -DI) × 100`

---

### +DI — Positive Directional Indicator

**+DI** measures upward price movement strength.

| Parameter | Type   | Default    | Description              |
|-----------|--------|------------|--------------------------|
| `period`  | number | *required* | Smoothing period         |

---

### -DI — Negative Directional Indicator

**-DI** measures downward price movement strength.

| Parameter | Type   | Default    | Description              |
|-----------|--------|------------|--------------------------|
| `period`  | number | *required* | Smoothing period         |

**Trading with +DI/-DI:**
- **+DI above -DI:** Bullish trend
- **-DI above +DI:** Bearish trend
- **DI crossovers:** Potential trend changes

---

### +DM and -DM — Directional Movement

**+DM** and **-DM** measure the positive and negative directional movement respectively. These are the raw building blocks for DI calculations.

---

## 🔄 Oscillators

Oscillators are bounded indicators that fluctuate between fixed values, typically indicating overbought/oversold conditions.

### RSI — Relative Strength Index

**RSI** measures the magnitude of recent price changes to evaluate overbought or oversold conditions.

| Parameter | Type   | Default    | Description              |
|-----------|--------|------------|--------------------------|
| `period`  | number | 14         | Lookback period          |
| `src`     | string | 'close'    | Price source             |

**Formula:** `RSI = 100 - (100 / (1 + RS))`  
Where RS = Average Gain / Average Loss

**Interpretation:**
- **Above 70:** Overbought — potential reversal down
- **Below 30:** Oversold — potential reversal up
- **50 line:** Trend direction indicator

**Advanced Techniques:**
- **Divergence:** Price vs RSI divergence signals reversals
- **Failure Swings:** RSI makes higher low in oversold territory

---

### CCI — Commodity Channel Index

**CCI** measures the current price level relative to an average price over a given period.

| Parameter | Type   | Default    | Description              |
|-----------|--------|------------|--------------------------|
| `period`  | number | 14         | Lookback period          |

**Formula:** `CCI = (Typical Price - SMA) / (0.015 × Mean Deviation)`

**Interpretation:**
- **Above +100:** Overbought or start of uptrend
- **Below -100:** Oversold or start of downtrend
- **Zero line crossings:** Momentum shifts

**Use Cases:**
- Trend identification
- Overbought/oversold detection
- Divergence trading

---

### AO — Awesome Oscillator

**Awesome Oscillator** measures market momentum by comparing a 5-period SMA of the midpoint to a 34-period SMA.

**Formula:** `AO = SMA(5, Midpoint) - SMA(34, Midpoint)`  
Where Midpoint = (High + Low) / 2

**Trading Signals:**
- **Zero line cross:** Momentum shift
- **Saucer signal:** Two consecutive bars of same color after opposite color
- **Twin peaks:** Divergence signal

---

## 📉 Volatility Indicators

Volatility indicators measure the rate and magnitude of price changes.

### ATR — Average True Range

**ATR** measures market volatility by calculating the average of true ranges over a period.

| Parameter | Type   | Default    | Description              |
|-----------|--------|------------|--------------------------|
| `period`  | number | *required* | Smoothing period         |

**True Range = Maximum of:**
- Current High - Current Low
- |Current High - Previous Close|
- |Current Low - Previous Close|

**Use Cases:**
- Stop-loss placement (e.g., 2× ATR)
- Position sizing
- Identifying volatility expansion/contraction
- Breakout confirmation

---

### ATRCD — ATR Convergence Divergence

**ATRCD** applies MACD-style analysis to ATR values, helping identify changes in volatility trends.

| Parameter   | Type   | Default    | Description              |
|-------------|--------|------------|--------------------------|
| `atrPeriod` | number | 14         | ATR period               |
| `short`     | number | 12         | Fast EMA period          |
| `long`      | number | 26         | Slow EMA period          |
| `signal`    | number | 9          | Signal line period       |

**Use Cases:**
- Volatility trend analysis
- Predicting volatility changes
- Strategy timing based on volatility

---

### Bollinger Bands

**Bollinger Bands** create an envelope around price using standard deviations from a moving average.

| Parameter   | Type   | Default    | Description                          |
|-------------|--------|------------|--------------------------------------|
| `period`    | number | 5          | Moving average period                |
| `stdevUp`   | number | 2          | Upper band standard deviations       |
| `stdevDown` | number | 2          | Lower band standard deviations       |
| `maType`    | string | 'sma'      | MA type: `sma`, `ema`, `dema`, `wma` |

**Output:**
- `upper` — Upper band (MA + stdev × multiplier)
- `middle` — Middle band (moving average)
- `lower` — Lower band (MA - stdev × multiplier)

**Trading Strategies:**
- **Squeeze:** Bands narrow before breakouts
- **Bounce:** Price touching bands may reverse
- **Walk the bands:** Strong trends ride upper/lower band

---

### True Range

**True Range** is the raw volatility measure used in ATR calculation.

**Formula:** Maximum of:
- High - Low
- |High - Previous Close|
- |Low - Previous Close|

---

## 📊 Volume Indicators

Volume indicators analyze trading activity to confirm trends and predict reversals.

### OBV — On-Balance Volume

**OBV** uses volume flow to predict changes in price by adding volume on up days and subtracting it on down days.

| Parameter   | Type   | Default    | Description              |
|-------------|--------|------------|--------------------------|
| `period`    | number | 14         | Bollinger Bands period   |
| `stdevUp`   | number | 2          | Upper band multiplier    |
| `stdevDown` | number | 2          | Lower band multiplier    |
| `maType`    | string | 'sma'      | MA type for bands        |

**Output:**
- `obv` — Cumulative OBV value
- `ma` — Moving average of OBV
- `upper` — Upper Bollinger Band
- `lower` — Lower Bollinger Band

**Interpretation:**
- **Rising OBV:** Buying pressure (bullish)
- **Falling OBV:** Selling pressure (bearish)
- **OBV divergence:** Potential reversal signal

---

### Volume Delta

**Volume Delta** analyzes the difference between buying and selling volume, applying MACD analysis for trend detection.

| Parameter   | Type   | Default    | Description                      |
|-------------|--------|------------|----------------------------------|
| `src`       | string | 'quote'    | Volume source: `quote` or `base` |
| `short`     | number | 12         | Fast EMA period                  |
| `long`      | number | 26         | Slow EMA period                  |
| `signal`    | number | 9          | Signal line period               |

**Output:**
- `volumeDelta` — Raw volume delta (buy - sell volume)
- `macd` — MACD of volume delta
- `signal` — Signal line
- `hist` — MACD histogram

**Use Cases:**
- Confirming price breakouts
- Identifying accumulation/distribution
- Detecting smart money activity

---

### EFI — Elder's Force Index

**Elder's Force Index** measures the force of bulls during upward movements and bears during downward movements.

**Formula:** `EFI = (Close - Previous Close) × Volume`

**Use Cases:**
- Trend confirmation
- Identifying potential reversals
- Measuring buying/selling pressure

---

## ⚙️ Common Parameters

### Price Sources

Many indicators accept a `src` parameter to specify which price to use:

| Source  | Description             | Formula                         |
|---------|-------------------------|---------------------------------|
| `open`  | Opening price           | —                               |
| `high`  | Highest price           | —                               |
| `low`   | Lowest price            | —                               |
| `close` | Closing price (default) | —                               |
| `hl2`   | Midpoint                | (High + Low) / 2                |
| `hlc3`  | Typical Price           | (High + Low + Close) / 3        |
| `ohlc4` | Average Price           | (Open + High + Low + Close) / 4 |

### Moving Average Types

Several indicators support different moving average types:

| Type    | Name                       | Characteristics             |
|---------|--------------------------- |-----------------------------|
| `sma`   | Simple Moving Average      | Equal weight, more lag      |
| `ema`   | Exponential Moving Average | Recent bias, less lag       |
| `dema`  | Double EMA                 | Reduced lag                 |
| `wma`   | Weighted Moving Average    | Linear weight increase      |

---

## 🔧 Using Indicators in Strategies

### Basic Usage

```typescript
import { RSI } from '@indicators/oscillators/rsi/rsi.indicator';
import { MACD } from '@indicators/momentum/macd/macd.indicator';

class MyStrategy extends Strategy {
  private rsi: RSI;
  private macd: MACD;

  init() {
    this.rsi = new RSI({ period: 14 });
    this.macd = new MACD({ short: 12, long: 26, signal: 9 });
  }

  onCandle(candle: Candle) {
    this.rsi.onNewCandle(candle);
    this.macd.onNewCandle(candle);

    const rsiValue = this.rsi.getResult();
    const { macd, signal, hist } = this.macd.getResult();

    // Trading logic here
  }
}
```

### Warmup Period

All indicators require a warmup period before producing valid results. During warmup, `getResult()` returns `null`. Always check for `null` before using indicator values:

```typescript
const rsiValue = this.rsi.getResult();
if (rsiValue === null) return; // Still warming up

// Use rsiValue safely
```

### Combining Multiple Indicators

For robust trading signals, combine multiple indicators:

```typescript
// Trend + Momentum + Volume confirmation
if (price > ema200 && rsi < 30 && obv.isRising()) {
  // Strong buy signal: uptrend + oversold + buying pressure
}
```

---
