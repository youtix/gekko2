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

1. **Initialization**: Rebalances the portfolio so that it funds every level of the grid with the same quantity, which is not a 50/50 split (see [Rebalancing](#rebalancing))
2. **Grid Building**: Places buy orders below and sell orders above the center price
3. **Order Management**: When an order fills, places an opposite order at the adjacent level
4. **Range Monitoring**: Logs warnings if price exits the grid range

#### Key Features

- **Automatic Rebalancing**: Splits the portfolio the way the grid uses it before building the grid, so that no capital sits idle
- **Three Spacing Types**: Fixed, percent, or logarithmic level distribution
- **Error Recovery**: Configurable retry limit for failed orders
- **Range Warnings**: Alerts when price moves outside the grid

#### Parameters

| Parameter                | Type                                    | Description                                           |
|--------------------------|-----------------------------------------|-------------------------------------------------------|
| `buyLevels`              | number                                  | Number of buy levels below center price               |
| `sellLevels`             | number                                  | Number of sell levels above center price              |
| `spacingType`            | `percent`, `fixed`, `logarithmic`       | How levels are spaced                                 |
| `spacingValue`           | number                                  | Distance between adjacent prices (see below)          |
| `retryOnError`           | number                                  | (optional) Retry limit for failed orders (default: 3) |

#### Spacing Types Explained

`spacingValue` is the distance between two adjacent prices of the grid, the center price included:

| Type          | `spacingValue` Meaning                 | Example                                                             |
|---------------|----------------------------------------|---------------------------------------------------------------------|
| `percent`     | Percent of the center price            | `1` = prices 1 % of the center price apart: 99, 100, 101 around 100 |
| `fixed`       | Price units                            | `500` = prices $500 apart                                           |
| `logarithmic` | Ratio between adjacent prices, minus 1 | `0.01` = each price 1 % above the one below it                      |

`percent` spacing is arithmetic, as `fixed` spacing is: each level is `spacingValue` % **of the center price** away from its neighbour, not `spacingValue` % of the neighbour itself. Measured against the prices themselves, the levels are therefore wider at the bottom of the grid than at the top: `10` around 100 places the prices at 50, 60, … 150, so that 50 → 60 is +20 % while 140 → 150 is +7 %. For the same percentage between every two adjacent prices, use `logarithmic` spacing.

#### Prices and Checks

The grid starts on the first candle after the warmup, centred on its close. Its prices are rounded to the market's price tick (`precision.price`) as they are written, a half tick rounding up: `fixed` and `percent` spacings are computed in decimal, `logarithmic` spacing in binary. A market that states no tick is priced to 8 decimals, with a warning when the grid starts; the dummy-cex configuration always states one (`precision.price`, in decimals).

The parameters are checked when the strategy is created, before the first candle: a key other than `name` and the parameters above, a quoted number, a fractional or negative level count, both level counts at 0, another `spacingType`, a `spacingValue` that is not a positive number or a `retryOnError` under 1 refuses the run. The checks that need the price run when the grid starts, before any order, and stop the run when:

- the lowest buy level would be at or below 0: with `percent` spacing, `buyLevels × spacingValue` must stay under 100;
- the center price is outside the exchange's price limits (`price.min`, `price.max`);
- two adjacent prices of the grid round to the same tick (see *Minimum spacing*).

**Minimum spacing.** Once rounded to the market's price tick, adjacent prices of the grid must stay at least one tick apart. A spacing that rounds two of them to the same price, a level that would buy and sell at that one price, stops the run when the grid starts, and again when the grid is built around the price a rebalance ended at (a `percent` or `logarithmic` step shrinks with the price).

A spacing whose levels earn less than the two maker fees of a round trip (`fee.maker`), a SELL less than 2 × fee / (1 − fee) above its BUY (0.08003 % at a 0.04 % fee, 0.2002 % at 0.1 %), is accepted with one warning, logged at the `warn` level: such a grid loses money at each round trip. For a 5/5 grid at 60000 with a 0.1 % maker fee, that takes a spacing of 121.1 or more with `fixed` spacing (100 loses money there), 0.2019 or more with `percent` and 0.002003 or more with `logarithmic`.

#### Rebalancing

Every level of the grid trades the same quantity. For a quantity `q`, the SELLs need `sellLevels × q` of the asset, and the BUYs need the sum of their prices × `q` of the currency, plus the maker fee (`fee.maker`), which the simulator of backtests and paper trading charges in currency on top of a BUY. The grid is sized on the free balances, rounded down to the market's amount precision, so what one side holds beyond what the other side funds stays idle for the whole run.

Before building the grid, GridBot therefore rebalances the free balances to that split with one STICKY order: it buys or sells the amount after which both sides fund the same quantity, the order's own price and fee included. Funds locked in other orders are left out. The portfolio is not rebalanced when the grid would leave less than 1 % of its value idle, nor when the rebalance would be smaller than the market's minimum order (`amount.min`, or `cost.min` at the price of the STICKY order): the grid is then built on the balances as they are.

The split is not 50/50, since the BUYs, below the center price, cost less than the SELLs are worth. A symmetric grid holds a little more than half of its value in the asset, about 51 % for 5/5 levels spaced by 1 % and 56 % for 20/20 levels spaced by 2 %, and an asymmetric one about its share of sell levels, 76 % for 1 buy and 3 sell levels spaced by 5 at 100. A grid without sell levels is rebalanced all in currency, and one without buy levels all in the asset, buying what the currency pays once the fee is on top.

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
