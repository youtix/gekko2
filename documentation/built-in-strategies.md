# Built-in Strategies

Gekko 2 comes with a variety of pre-built trading strategies that you can use right out of the box. Each strategy is designed with different market conditions and trading styles in mind.

---

## Strategy Overview

| Strategy                                                        | Category          | Order Type | Best For            |
|-----------------------------------------------------------------|-------------------|------------|---------------------|
| [DEMA](#dema---double-exponential-moving-average)               | Mean Reversion    | STICKY     | Trend reversals     |
| [MACD](#macd---moving-average-convergence-divergence)           | Momentum          | STICKY     | Trend reversals     |
| [RSI](#rsi---relative-strength-index)                           | Mean Reversion    | STICKY     | Overbought/Oversold |
| [CCI](#cci---commodity-channel-index)                           | Mean Reversion    | STICKY     | Cyclical markets    |
| [TMA](#tma---triple-moving-average)                             | Trend Following   | STICKY     | Strong trends       |
| [SMACrossover](#smacrossover---simple-moving-average-crossover) | Trend Following   | MARKET     | Quick entries       |
| [EMARibbon](#emaribbon---exponential-moving-average-ribbon)     | Trend Following   | STICKY     | Trend confirmation  |
| [GridBot](#gridbot---grid-trading-strategy)                     | Range Trading     | LIMIT      | Sideways markets    |

---

## Trend Following Strategies

### TMA — Triple Moving Average

The TMA strategy uses **three Simple Moving Averages** with different periods (short, medium, long) to identify trend direction. This multi-timeframe approach helps filter out noise and confirms trends before taking action.

#### How It Works

1. Calculates three SMAs: short, medium, and long period
2. **BUY Signal**: When flat, if `short > medium > long` (bullish alignment)
3. **SELL Signal**: When in position, if the alignment is mixed: the medium SMA above both others (`short < medium` and `medium > long`) or below both (`short > medium` and `medium < long`). A fully bearish alignment (`short < medium < long`) gives no signal
4. The strategy starts flat and advises nothing while one of its orders is pending. An order canceled or refused is placed again on the next candle where its signal still holds

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
2. **BUY Signal**: When flat, if the price crosses **above** the SMA (SMA crossed down the price)
3. **SELL Signal**: When in position, if the price crosses **below** the SMA (SMA crossed up the price)
4. The first candle after warmup only records where the price is. The strategy starts flat and advises nothing while one of its orders is pending: a crossover the position does not allow is skipped

#### Parameters

| Parameter | Type         | Description                                                          |
|-----------|--------------|----------------------------------------------------------------------|
| `period`  | number       | The lookback period for the SMA                                      |
| `src`     | InputSources | Price source: `close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4` |

#### Example Configuration

```yaml
strategy:
  name: SMACrossover
  period: 20
  src: close
```

#### When to Use

- Markets with clear momentum shifts
- When you want quick entries via market orders
- Short to medium-term trading

---

### EMARibbon — Exponential Moving Average Ribbon

The EMARibbon strategy uses multiple **Exponential Moving Averages** arranged as a ribbon. It buys when a tight bullish ribbon (fastest EMA on top) starts to open up, and sells as soon as the ribbon narrows again.

#### How It Works

1. Creates a ribbon of `count` EMAs starting from `start` period, incrementing by `step` for each additional EMA
2. Measures the ribbon's **spread** on each candle: the gap between its highest and lowest EMA, in price units (quote currency)
3. **BUY Signal**: When flat, if the EMAs are in descending order (each faster EMA above the slower one), the spread is below `spreadCompressionThreshold` and it has not narrowed since the previous candle
4. **SELL Signal**: When in position, as soon as the spread narrows from one candle to the next, whatever the order of the EMAs

#### Parameters

| Parameter                    | Type             | Description                                                     |
|------------------------------|------------------|-----------------------------------------------------------------|
| `src`                        | `close`, `ohlc4` | Price source for calculation                                    |
| `count`                      | number           | Number of EMAs in the ribbon                                    |
| `start`                      | number           | Period for the first (fastest) EMA                              |
| `step`                       | number           | Period increment for each subsequent EMA                        |
| `spreadCompressionThreshold` | number           | Spread, in quote currency, below which a bullish ribbon can buy |

#### Example Configuration

```yaml
strategy:
  name: EMARibbon
  src: close
  count: 8
  start: 10
  step: 5
  # Creates EMAs with periods: 10, 15, 20, 25, 30, 35, 40, 45
  spreadCompressionThreshold: 500 # In quote currency (500 USDT on BTC/USDT): scale it with the price of the pair
```

#### When to Use

- Strong momentum markets
- When you want visual confirmation of trend strength
- Trend-following with multiple confirmations

---

## Momentum & Mean Reversion Strategies

### DEMA — Double Exponential Moving Average

The DEMA strategy uses the difference between a **Double Exponential Moving Average** and a **Simple Moving Average** to detect trend changes. DEMA responds faster to price changes than a traditional EMA, making it suitable for catching medium-term trend reversals.

#### How It Works

1. Calculates the DEMA and SMA for the configured period
2. Computes the difference: `diff = SMA - DEMA`
3. When flat, once the difference exceeds the **up threshold** (logged as an **uptrend**) → **BUY**
4. When in position, once the difference drops below the **down threshold** (logged as a **downtrend**) → **SELL**
5. One advice per trend: the strategy starts flat and advises nothing while one of its orders is pending. An order canceled or refused waits for the next trend

> [!NOTE]
> The DEMA follows the price closely while the SMA lags behind it, so a positive `diff` means the price has just fallen below its average, and a negative one that it has just risen above it. The strategy buys after a fall and sells after a rise: it trades against the recent move, as Gekko 1's DEMA did, although its logs call these an uptrend and a downtrend.

#### Parameters

| Parameter         | Type    | Description                                               |
|-------------------|---------|-----------------------------------------------------------|
| `period`          | number  | The lookback period for both DEMA and SMA calculations    |
| `thresholds.up`   | number  | `diff` above which it buys, in quote currency (positive)  |
| `thresholds.down` | number  | `diff` below which it sells, in quote currency (negative) |

#### Example Configuration

```yaml
strategy:
  name: DEMA
  period: 21
  thresholds:
    up: 0.0025
    down: -0.0025
```

#### When to Use

- Markets that swing around their average rather than trend in one direction
- Medium-term trading (hours to days)
- When you want faster response than traditional moving averages

---

### MACD — Moving Average Convergence Divergence

The MACD strategy is based on the popular **MACD indicator**, which calculates the difference between a short and long-period EMA. It includes a **persistence filter** to confirm trends before acting.

#### How It Works

1. Calculates MACD line, signal line, and histogram
2. Uses the configured source (`macd`, `signal`, or `hist`) for comparison
3. When flat, once the source has been above the **up threshold** for the required **persistence period** → **BUY**
4. When in position, once the source has been below the **down threshold** for the required **persistence period** → **SELL**
5. One advice per trend: the strategy starts flat and advises nothing while one of its orders is pending. An order canceled or refused waits for the next trend, and a trend shorter than the persistence period advises nothing

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
2. When flat, once RSI has been below the **low threshold** (oversold) for the persistence period → **BUY**
3. When in position, once RSI has been above the **high threshold** (overbought) for the persistence period → **SELL**
4. One advice per trend: the strategy starts flat and advises nothing while one of its orders is pending. An order canceled or refused waits for the next trend, and a trend shorter than the persistence period advises nothing

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
2. When in position, once CCI has been at or above the **up threshold** (overbought) for the persistence period → **SELL**
3. When flat, once CCI has been at or below the **down threshold** (oversold) for the persistence period → **BUY**
4. One advice per trend: a trend ends as soon as CCI is back between the thresholds. The strategy starts flat and advises nothing while one of its orders is pending. An order canceled or refused waits for the next trend

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
