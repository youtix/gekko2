# Built-in Strategies

Gekko 2 comes with a variety of pre-built trading strategies that you can use right out of the box. Each strategy is designed with different market conditions and trading styles in mind.

---

## Strategy Overview

| Strategy                                                        | Category          | Order Type | Best For            |
|-----------------------------------------------------------------|-------------------|------------|---------------------|
| [DEMA](#dema---double-exponential-moving-average)               | Trend Following   | STICKY     | Medium-term trends  |
| [MACD](#macd---moving-average-convergence-divergence)           | Momentum          | STICKY     | Trend reversals     |
| [RSI](#rsi---relative-strength-index)                           | Mean Reversion    | STICKY     | Overbought/Oversold |
| [CCI](#cci---commodity-channel-index)                           | Mean Reversion    | STICKY     | Cyclical markets    |
| [TMA](#tma---triple-moving-average)                             | Trend Following   | STICKY     | Strong trends       |
| [SMACrossover](#smacrossover---simple-moving-average-crossover) | Trend Following   | MARKET     | Quick entries       |
| [EMARibbon](#emaribbon---exponential-moving-average-ribbon)     | Trend Following   | STICKY     | Trend confirmation  |
| [VolumeDelta](#volumedelta---volume-based-signals)              | Volume Analysis   | STICKY     | Volume-driven moves |
| [GridBot](#gridbot---grid-trading-strategy)                     | Range Trading     | LIMIT      | Sideways markets    |

---

## Trend Following Strategies

### DEMA — Double Exponential Moving Average

The DEMA strategy uses the difference between a **Double Exponential Moving Average** and a **Simple Moving Average** to detect trend changes. DEMA responds faster to price changes than a traditional EMA, making it suitable for catching medium-term trend reversals.

#### How It Works

1. Calculates the DEMA and SMA for the configured period
2. Computes the difference: `diff = SMA - DEMA`
3. When the difference exceeds the **up threshold**, the market is considered in an **uptrend** → **BUY**
4. When the difference drops below the **down threshold**, the market is in a **downtrend** → **SELL**

#### Parameters

| Parameter         | Type    | Description                                            |
|-------------------|---------|--------------------------------------------------------|
| `period`          | number  | The lookback period for both DEMA and SMA calculations |
| `thresholds.up`   | number  | Positive threshold for uptrend detection               |
| `thresholds.down` | number  | Negative threshold for downtrend detection             |

#### Example Configuration

```yaml
strategy:
  name: DEMA
  params:
    period: 21
    thresholds:
      up: 0.0025
      down: -0.0025
```

#### When to Use

- Markets with clear directional trends
- Medium-term trading (hours to days)
- When you want faster response than traditional moving averages

---

### TMA — Triple Moving Average

The TMA strategy uses **three Simple Moving Averages** with different periods (short, medium, long) to identify trend direction. This multi-timeframe approach helps filter out noise and confirms trends before taking action.

#### How It Works

1. Calculates three SMAs: short, medium, and long period
2. **BUY Signal**: When `short > medium > long` (bullish alignment)
3. **SELL Signal**: When any other configuration (bearish or mixed alignment)

#### Parameters

| Parameter | Type         | Description                                                          |
|-----------|--------------|----------------------------------------------------------------------|
| `short`   | number       | Period for the short-term SMA (fastest)                              |
| `medium`  | number       | Period for the medium-term SMA                                       |
| `long`    | number       | Period for the long-term SMA (slowest)                               |
| `src`     | InputSources | Price source: `close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4` |

#### Example Configuration

```yaml
strategy:
  name: TMA
  params:
    short: 10
    medium: 21
    long: 50
    src: close
```

#### When to Use

- Strong trending markets
- When you want confirmation from multiple timeframes
- Longer-term position trading

---

### SMACrossover — Simple Moving Average Crossover

The SMACrossover strategy is a classic crossover strategy that generates signals when the price crosses the **Simple Moving Average**. It uses **MARKET orders** for immediate execution.

#### How It Works

1. Calculates an SMA for the configured period
2. **BUY Signal**: When price crosses **above** the SMA (SMA crossed down the price)
3. **SELL Signal**: When price crosses **below** the SMA (SMA crossed up the price)

#### Parameters

| Parameter | Type         | Description                                                          |
|-----------|--------------|----------------------------------------------------------------------|
| `period`  | number       | The lookback period for the SMA                                      |
| `src`     | InputSources | Price source: `close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4` |

#### Example Configuration

```yaml
strategy:
  name: SMACrossover
  params:
    period: 20
    src: close
```

#### When to Use

- Markets with clear momentum shifts
- When you want quick entries via market orders
- Short to medium-term trading

---

### EMARibbon — Exponential Moving Average Ribbon

The EMARibbon strategy uses multiple **Exponential Moving Averages** arranged as a ribbon. When all EMAs are in descending order (fastest above slowest), it signals a bullish trend.

#### How It Works

1. Creates a ribbon of EMAs starting from `start` period, incrementing by `step` for each additional EMA
2. **BUY Signal**: When all EMAs are arranged in descending order (each faster EMA is above the slower one)
3. **SELL Signal**: When the ribbon arrangement breaks (bullish alignment lost)

#### Parameters

| Parameter | Type         | Description                              |
|-----------|--------------|------------------------------------------|
| `src`     | InputSources | Price source for calculation             |
| `count`   | number       | Number of EMAs in the ribbon             |
| `start`   | number       | Period for the first (fastest) EMA       |
| `step`    | number       | Period increment for each subsequent EMA |

#### Example Configuration

```yaml
strategy:
  name: EMARibbon
  params:
    src: close
    count: 8
    start: 10
    step: 5
    # Creates EMAs with periods: 10, 15, 20, 25, 30, 35, 40, 45
```

#### When to Use

- Strong momentum markets
- When you want visual confirmation of trend strength
- Trend-following with multiple confirmations

---

## Momentum & Mean Reversion Strategies

### MACD — Moving Average Convergence Divergence

The MACD strategy is based on the popular **MACD indicator**, which calculates the difference between a short and long-period EMA. It includes a **persistence filter** to confirm trends before acting.

#### How It Works

1. Calculates MACD line, signal line, and histogram
2. Uses the configured source (`macd`, `signal`, or `hist`) for comparison
3. When the source exceeds the **up threshold** for the required **persistence period** → **BUY**
4. When the source drops below the **down threshold** for the required **persistence period** → **SELL**

#### Parameters

| Parameter                | Type                        | Description                                  |
|--------------------------|-----------------------------|----------------------------------------------|
| `short`                  | number                      | Short EMA period (typically 12)              |
| `long`                   | number                      | Long EMA period (typically 26)               |
| `signal`                 | number                      | Signal line EMA period (typically 9)         |
| `macdSrc`                | `macd`, `signal`, or `hist` | Which MACD component to use for signals      |
| `thresholds.up`          | number                      | Positive threshold for uptrend               |
| `thresholds.down`        | number                      | Negative threshold for downtrend             |
| `thresholds.persistence` | number                      | Candles the trend must persist before action |

#### Example Configuration

```yaml
strategy:
  name: MACD
  params:
    short: 12
    long: 26
    signal: 9
    macdSrc: hist
    thresholds:
      up: 0
      down: 0
      persistence: 1
```

#### When to Use

- Markets with momentum shifts
- When you want confirmation via persistence
- Identifying trend reversals

---

### RSI — Relative Strength Index

The RSI strategy uses the **Relative Strength Index** to identify overbought and oversold conditions. It includes a **persistence filter** to avoid false signals.

#### How It Works

1. Calculates the RSI for the configured period
2. When RSI drops below the **low threshold** (oversold) for the persistence period → **BUY**
3. When RSI rises above the **high threshold** (overbought) for the persistence period → **SELL**

#### Parameters

| Parameter                | Type         | Description                           |
|--------------------------|--------------|---------------------------------------|
| `period`                 | number       | RSI calculation period (typically 14) |
| `src`                    | InputSources | Price source for calculation          |
| `thresholds.high`        | number       | Overbought level (typically 70)       |
| `thresholds.low`         | number       | Oversold level (typically 30)         |
| `thresholds.persistence` | number       | Candles the condition must persist    |

#### Example Configuration

```yaml
strategy:
  name: RSI
  params:
    period: 14
    src: close
    thresholds:
      high: 70
      low: 30
      persistence: 1
```

#### When to Use

- Range-bound or mean-reverting markets
- Identifying overbought/oversold conditions
- Counter-trend trading

---

### CCI — Commodity Channel Index

The CCI strategy uses the **Commodity Channel Index** to identify overbought and oversold conditions based on price deviation from the mean.

#### How It Works

1. Calculates the CCI for the configured period
2. When CCI rises above the **up threshold** (overbought) for the persistence period → **SELL**
3. When CCI drops below the **down threshold** (oversold) for the persistence period → **BUY**

#### Parameters

| Parameter                | Type   | Description                           |
|--------------------------|--------|---------------------------------------|
| `period`                 | number | CCI calculation period (typically 20) |
| `thresholds.up`          | number | Overbought level (typically +100)     |
| `thresholds.down`        | number | Oversold level (typically -100)       |
| `thresholds.persistence` | number | Candles the condition must persist    |

#### Example Configuration

```yaml
strategy:
  name: CCI
  params:
    period: 20
    thresholds:
      up: 100
      down: -100
      persistence: 0
```

#### When to Use

- Cyclical or mean-reverting markets
- Identifying extreme price deviations
- Commodity and cryptocurrency markets

---

## Volume Analysis Strategies

### VolumeDelta — Volume-Based Signals

The VolumeDelta strategy analyzes **buying vs selling volume** using the Volume Delta indicator with MACD smoothing. It generates signals based on volume momentum.

#### How It Works

1. Calculates Volume Delta (difference between buy and sell volume)
2. Applies MACD calculation on the volume delta
3. Uses the configured output (`volumeDelta`, `macd`, `signal`, or `hist`) for comparison
4. When the output exceeds the **up threshold** for persistence → **BUY**
5. When the output drops below the **down threshold** for persistence → **SELL**

#### Parameters

| Parameter                | Type                                    | Description                           |
|--------------------------|-----------------------------------------|---------------------------------------|
| `src`                    | `quote` or `base`                       | Volume source                         |
| `short`                  | number                                  | Short period for MACD calculation     |
| `long`                   | number                                  | Long period for MACD calculation      |
| `signal`                 | number                                  | Signal line period                    |
| `output`                 | `volumeDelta`, `macd`, `signal`, `hist` | Output to use for signals             |
| `thresholds.up`          | number                                  | Positive threshold for bullish signal |
| `thresholds.down`        | number                                  | Negative threshold for bearish signal |
| `thresholds.persistence` | number                                  | Candles the condition must persist    |

#### Example Configuration

```yaml
strategy:
  name: VolumeDelta
  params:
    src: quote
    short: 12
    long: 26
    signal: 9
    output: hist
    thresholds:
      up: 0
      down: 0
      persistence: 1
```

#### When to Use

- High-volume markets
- When volume is a leading indicator
- Confirming price moves with volume

---

## Range Trading Strategies

### GridBot — Grid Trading Strategy

The GridBot is a sophisticated **grid trading strategy** that places a series of LIMIT orders above and below the current price. It profits from price oscillations within a range.

#### How It Works

1. **Initialization**: Rebalances portfolio to 50/50 allocation (asset/currency)
2. **Grid Building**: Places buy orders below and sell orders above the center price
3. **Order Management**: When an order fills, places an opposite order at the adjacent level
4. **Range Monitoring**: Logs warnings if price exits the grid range

#### Key Features

- **Automatic Rebalancing**: Ensures equal allocation before building the grid
- **Three Spacing Types**: Fixed, percent, or logarithmic level distribution
- **Error Recovery**: Configurable retry limit for failed orders
- **Range Warnings**: Alerts when price moves outside the grid

#### Parameters

| Parameter                | Type                                    | Description                                           |
|--------------------------|-----------------------------------------|-------------------------------------------------------|
| `buyLevels`              | number                                  | Number of buy levels below center price               |
| `sellLevels`             | number                                  | Number of sell levels above center price              |
| `spacingType`            | `percent`, `fixed`, `logarithmic`       | How levels are spaced                                 |
| `spacingValue`           | number                                  | Distance between levels                               |
| `retryOnError`           | number                                  | (optional) Retry limit for failed orders (default: 3) |

#### Spacing Types Explained

| Type          | `spacingValue` Meaning | Example              |
|---------------|------------------------|----------------------|
| `percent`     | Expressed in percent   | `1` = 1% spacing     |
| `fixed`       | Price units            | `100` = $100 spacing |
| `logarithmic` | Multiplier increment   | `0.01` = +1% per hop |

#### Example Configuration

```yaml
strategy:
  name: GridBot
  params:
    buyLevels: 5
    sellLevels: 5
    spacingType: percent
    spacingValue: 1
    retryOnError: 3
```

#### When to Use

- **Sideways/ranging markets** with clear support and resistance
- When you expect price to oscillate within a range
- Markets with sufficient liquidity for limit orders
- When you want to profit from volatility without directional bias

> [!CAUTION]
> Grid strategies can accumulate losses if the price breaks out of the range in one direction. Always set appropriate position sizes and consider using stop-losses.

---

## Strategy Selection Guide

| Your Goal                   | Recommended Strategy |
|-----------------------------|----------------------|
| Follow strong trends        | TMA, EMARibbon       |
| Catch trend reversals       | DEMA, MACD           |
| Trade overbought/oversold   | RSI, CCI             |
| Profit from ranging markets | GridBot              |
| Quick entries on crossovers | SMACrossover         |
| Volume-confirmed signals    | VolumeDelta          |
