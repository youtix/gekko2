# Custom Strategies

This guide explains how to create your own custom trading strategies and run them with Gekko 2. Custom strategies live **outside** the Gekko 2 codebase, enabling you to develop and iterate on your trading logic independently.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Strategy Interface](#strategy-interface)
- [Lifecycle Methods](#lifecycle-methods)
- [Tools Available](#tools-available)
- [Using Indicators](#using-indicators)
- [Creating Orders](#creating-orders)
- [Configuration File](#configuration-file)
- [Running with Executable](#running-with-executable)
- [Complete Example](#complete-example)
- [Best Practices](#best-practices)

---

## Overview

Custom strategies allow you to:

- **Develop independently** — Keep your proprietary trading logic separate from the Gekko 2 core
- **Iterate quickly** — Modify and test strategies without rebuilding Gekko 2
- **Use any indicators** — Access all 25+ built-in technical indicators
- **Handle order events** — React to order completions, cancellations, and errors

---

## Quick Start

### 1. Create Your Strategy File

Create a new TypeScript file anywhere on your system (e.g., `./strategies/myStrategy.strategy.ts`):

```typescript
import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';

// Define your parameters interface
interface MyStrategyParams {
  period: number;
  threshold: number;
}

// Export your strategy class with the exact name you'll reference in config
export class MyStrategy implements Strategy<MyStrategyParams> {
  init(params: InitParams<MyStrategyParams>): void {
    // Initialize indicators here
  }

  onTimeframeCandleAfterWarmup(params: OnCandleEventParams<MyStrategyParams>, ...indicators: unknown[]): void {
    // Your main trading logic goes here
  }

  // Required methods (can be empty if unused)
  onEachTimeframeCandle(params: OnCandleEventParams<MyStrategyParams>, ...indicators: unknown[]): void {}
  log(params: OnCandleEventParams<MyStrategyParams>, ...indicators: unknown[]): void {}
  onOrderCompleted(params: OnOrderCompletedEventParams<MyStrategyParams>, ...indicators: unknown[]): void {}
  onOrderCanceled(params: OnOrderCanceledEventParams<MyStrategyParams>, ...indicators: unknown[]): void {}
  onOrderErrored(params: OnOrderErroredEventParams<MyStrategyParams>, ...indicators: unknown[]): void {}
  end(): void {}
}
```

### 2. Create Your Configuration File

Create a YAML configuration file (e.g., `config.yaml`):

```yaml
watch:
  asset: BTC
  currency: USDT
  mode: backtest
  timeframe: 1h
  warmup:
    candleCount: 100

exchange:
  name: dummy-cex

storage:
  type: sqlite
  database: ./db/binance-BTC_USDT.sql

strategy:
  name: MyStrategy
  period: 14
  threshold: 0.5

plugins:
  - name: TradingAdvisor
    strategyName: MyStrategy
    strategyPath: ./strategies/myStrategy.strategy.ts

  - name: Trader

  - name: PerformanceAnalyzer
    enableConsoleTable: true
```

### 3. Run Your Strategy

```bash
# Using the compiled executable
GEKKO_CONFIG_FILE_PATH=./config.yml ./dist/gekko2
```

---

## Strategy Interface

Every custom strategy must implement the `Strategy<T>` interface, where `T` is your parameters type:

```typescript
interface Strategy<T> {
  init(params: InitParams<T>): void;
  onEachTimeframeCandle(params: OnCandleEventParams<T>, ...indicators: unknown[]): void;
  onTimeframeCandleAfterWarmup(params: OnCandleEventParams<T>, ...indicators: unknown[]): void;
  log(params: OnCandleEventParams<T>, ...indicators: unknown[]): void;
  onOrderCompleted(params: OnOrderCompletedEventParams<T>, ...indicators: unknown[]): void;
  onOrderCanceled(params: OnOrderCanceledEventParams<T>, ...indicators: unknown[]): void;
  onOrderErrored(params: OnOrderErroredEventParams<T>, ...indicators: unknown[]): void;
  end(): void;
}
```

---

## Lifecycle Methods

### `init` — Strategy Initialization

Called **once** when the first candle arrives. Use this to register indicators.

```typescript
init({ tools, addIndicator }: InitParams<MyParams>): void {
  // Register indicators (they'll be updated automatically)
  addIndicator('EMA', { period: tools.strategyParams.short });
  addIndicator('EMA', { period: tools.strategyParams.long });
}
```

> [!IMPORTANT]
> Indicators are passed to other methods in the **same order** you register them in `init`.

---

### `onEachTimeframeCandle` — Every Candle (Including Warmup)

Called on **every** timeframe candle from the very beginning, including during warmup.

```typescript
onEachTimeframeCandle({ candle, portfolio, tools }: OnCandleEventParams<MyParams>, ...indicators: unknown[]): void {
  // Track data even during warmup
  this.priceHistory.push(candle.close);
}
```

---

### `onTimeframeCandleAfterWarmup` — Trading Logic (After Warmup)

Called on each timeframe candle **after** the warmup period completes. **This is where your main trading logic belongs.**

```typescript
onTimeframeCandleAfterWarmup({ candle, portfolio, tools }: OnCandleEventParams<MyParams>, ...indicators: unknown[]): void {
  const { createOrder, log, strategyParams } = tools;
  const [shortEma, longEma] = indicators as [number, number];

  if (shortEma > longEma && this.position !== 'long') {
    log('info', 'EMA crossover detected — going LONG');
    createOrder({ type: 'STICKY', side: 'BUY' });
    this.position = 'long';
  }
}
```

---

### `log` — Logging Hook

Called after each candle (post-warmup) to log indicator values and debug info.

```typescript
log({ candle, tools }: OnCandleEventParams<MyParams>, ...indicators: unknown[]): void {
  const [shortEma, longEma] = indicators as [number, number];
  tools.log('debug', `EMA Short: ${shortEma?.toFixed(2)} | Long: ${longEma?.toFixed(2)}`);
}
```

---

### `onOrderCompleted` — Order Filled

Called when an order is successfully filled by the exchange.

```typescript
onOrderCompleted({ order, exchange, tools }: OnOrderCompletedEventParams<MyParams>): void {
  tools.log('info', `Order ${order.id} completed: ${order.side} ${order.amount} @ ${order.price}`);
}
```

---

### `onOrderCanceled` — Order Canceled

Called when an order is canceled.

```typescript
onOrderCanceled({ order, tools }: OnOrderCanceledEventParams<MyParams>): void {
  tools.log('warn', `Order ${order.id} was canceled`);
}
```

---

### `onOrderErrored` — Order Failed

Called when an order fails or is rejected by the exchange.

```typescript
onOrderErrored({ order, tools }: OnOrderErroredEventParams<MyParams>): void {
  tools.log('error', `Order ${order.id} failed`);
  // Implement retry logic if needed
}
```

---

### `end` — Strategy Cleanup

Called when the strategy ends (backtest completes or bot stops).

```typescript
end(): void {
  // Cleanup resources, log final statistics, etc.
}
```

---

## Tools Available

Every lifecycle method receives a `tools` object with utilities:

| Tool              | Type                   | Description                                     |
|-------------------|------------------------|-------------------------------------------------|
| `strategyParams`  | `T` (your params type) | Your strategy parameters from config            |
| `marketData`      | `MarketData`           | Current market information                      |
| `log`             | `(level, msg) => void` | Log messages (`debug`, `info`, `warn`, `error`) |
| `createOrder`     | `(order) => UUID`      | Create a new order                              |
| `cancelOrder`     | `(orderId) => void`    | Cancel an existing order                        |

---

## Using Indicators

Register indicators in `init` and receive their values in candle handlers:

```typescript
init({ addIndicator, tools }: InitParams<MyParams>): void {
  // Indicators are calculated automatically on each candle
  addIndicator('SMA', { period: 20 });
  addIndicator('RSI', { period: 14 });
  addIndicator('MACD', { short: 12, long: 26, signal: 9 });
}

onTimeframeCandleAfterWarmup(params: OnCandleEventParams<MyParams>, ...indicators: unknown[]): void {
  // Access in the same order you registered them
  const [sma, rsi, macd] = indicators as [number, number, { macd: number; signal: number; hist: number }];
  
  if (rsi < 30 && params.candle.close > sma) {
    // Buy signal logic
  }
}
```

See the [Indicators Documentation](./indicators.md) for all available indicators.

---

## Creating Orders

Use `tools.createOrder()` to place trades:

### Order Types

| Type       | Description                                                   |
|------------|---------------------------------------------------------------|
| `STICKY`   | Limit order that follows price, converts to market at timeout |
| `MARKET`   | Immediate market order                                        |
| `LIMIT`    | Standard limit order at specified price                       |

### Order Parameters

```typescript
createOrder({
  type: 'STICKY' | 'MARKET' | 'LIMIT',
  side: 'BUY' | 'SELL',
  amount?: number,      // Optional: specific amount (defaults to full balance)
  price?: number,       // Required for LIMIT orders
});
```

### Examples

```typescript
// Full position market buy
createOrder({ type: 'MARKET', side: 'BUY' });

// Specific amount sticky sell
createOrder({ type: 'STICKY', side: 'SELL', amount: 0.5 });

// Limit order at specific price
createOrder({ type: 'LIMIT', side: 'BUY', price: 42000, amount: 0.1 });
```

---

## Configuration File

### TradingAdvisor Plugin Configuration

The key configuration for custom strategies is in the `TradingAdvisor` plugin:

```yaml
plugins:
  - name: TradingAdvisor
    strategyName: CustomStrategy    # Must match your exported class name
    strategyPath: ./strategies/mia2.strategy.ts  # Path to your strategy file
```

| Parameter      | Type   | Required | Description                              |
|----------------|--------|----------|------------------------------------------|
| `strategyName` | string | Yes      | The exact name of your exported class    |
| `strategyPath` | string | Yes      | Path to your strategy file (relative or absolute) |

### Strategy Parameters

All properties under `strategy:` (except `name`) are passed to your strategy via `tools.strategyParams`:

```yaml
strategy:
  name: CustomStrategy     # Used for identification
  src: close               # Accessible via tools.strategyParams.src
  short: 425               # Accessible via tools.strategyParams.short
  long: 2520               # Accessible via tools.strategyParams.long
  signal: 2750             # Accessible via tools.strategyParams.signal
  bullRibbon:              # Nested objects work too
    count: 13
    start: 2500
```

---

## Running with Executable

### Build the Executable

```bash
bun run build:exec
```

This creates a standalone binary at `dist/gekko2` that can run **without Bun installed**.

### Run Your Strategy

```bash
# With relative strategy path
GEKKO_CONFIG_FILE_PATH=./config.yml ./dist/gekko2

# With absolute strategy path (recommended for deployment)
GEKKO_CONFIG_FILE_PATH=/path/to/config.yml ./dist/gekko2
```

> [!TIP]
> When deploying, use absolute paths for `strategyPath` to avoid working directory issues:
> ```yaml
> strategyPath: /home/user/strategies/myStrategy.strategy.ts
> ```

---

## Complete Example

Here's a complete EMA crossover strategy with proper structure:

### Strategy File: `./strategies/emaCrossover.strategy.ts`

```typescript
import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';

interface EMACrossoverParams {
  src: 'close' | 'open' | 'high' | 'low';
  shortPeriod: number;
  longPeriod: number;
}

export class EMACrossover implements Strategy<EMACrossoverParams> {
  private position: 'long' | 'short' | 'none' = 'none';

  init({ addIndicator, tools }: InitParams<EMACrossoverParams>): void {
    const { shortPeriod, longPeriod } = tools.strategyParams;
    addIndicator('EMA', { period: shortPeriod });
    addIndicator('EMA', { period: longPeriod });
  }

  onTimeframeCandleAfterWarmup(
    { candle, tools }: OnCandleEventParams<EMACrossoverParams>,
    ...indicators: unknown[]
  ): void {
    const { log, createOrder } = tools;
    const [shortEma, longEma] = indicators as [number, number];

    if (!shortEma || !longEma) return;

    // Golden cross: short EMA crosses above long EMA
    if (shortEma > longEma && this.position !== 'long') {
      log('info', `Golden cross at ${candle.close} — BUY signal`);
      createOrder({ type: 'STICKY', side: 'BUY' });
      this.position = 'long';
    }
    // Death cross: short EMA crosses below long EMA
    else if (shortEma < longEma && this.position !== 'short') {
      log('info', `Death cross at ${candle.close} — SELL signal`);
      createOrder({ type: 'STICKY', side: 'SELL' });
      this.position = 'short';
    }
  }

  log({ tools }: OnCandleEventParams<EMACrossoverParams>, ...indicators: unknown[]): void {
    const [shortEma, longEma] = indicators as [number, number];
    if (shortEma && longEma) {
      tools.log('debug', `EMA(short): ${shortEma.toFixed(2)} | EMA(long): ${longEma.toFixed(2)}`);
    }
  }

  // Empty implementations for unused methods
  onEachTimeframeCandle(): void {}
  onOrderCompleted(): void {}
  onOrderCanceled(): void {}
  onOrderErrored(): void {}
  end(): void {}
}
```

### Configuration File: `ema-crossover-config.yaml`

```yaml
showLogo: false

watch:
  asset: BTC
  currency: USDT
  mode: backtest
  timeframe: 1h
  warmup:
    candleCount: 200
  dateRange:
    start: 2024-01-01
    end: 2024-12-31

exchange:
  name: dummy-cex

storage:
  type: sqlite
  database: ./db/binance-BTC_USDT.sql

strategy:
  name: EMACrossover
  src: close
  shortPeriod: 12
  longPeriod: 26

plugins:
  - name: TradingAdvisor
    strategyName: EMACrossover
    strategyPath: ./strategies/emaCrossover.strategy.ts

  - name: Trader

  - name: PerformanceAnalyzer
    enableConsoleTable: true
```

### Run the Backtest

```bash
# Build executable (only needed once)
bun run build:exec

# Run backtest
GEKKO_CONFIG_FILE_PATH=ema-crossover-config.yaml ./dist/gekko2
```

---

## Best Practices

### 1. Type Your Parameters

Always define a typed interface for your strategy parameters:

```typescript
interface MyParams {
  period: number;
  threshold: number;
  mode: 'aggressive' | 'conservative';
}
```

### 2. Validate Indicator Values

Indicators may return `null` during warmup edge cases:

```typescript
const [ema] = indicators as [number | null];
if (!ema || !Number.isFinite(ema)) return;
```

### 3. Track State Properly

Use class properties to track position state and avoid duplicate signals:

```typescript
private currentTrend?: 'up' | 'down';

// Only act on trend changes
if (signal === 'up' && this.currentTrend !== 'up') {
  this.currentTrend = 'up';
  createOrder({ type: 'STICKY', side: 'BUY' });
}
```

### 4. Use Appropriate Log Levels

| Level   | Use For                                      |
|---------|----------------------------------------------|
| `debug` | Indicator values, calculation details        |
| `info`  | Trade signals, important state changes       |
| `warn`  | Recoverable issues, edge cases               |
| `error` | Failures that need attention                 |

### 5. Set Adequate Warmup

Your warmup period should be at least as long as your longest indicator period:

```yaml
warmup:
  candleCount: 100  # If using SMA(50), use at least 50
```

> [!WARNING]
> If warmup is too short, indicators will not have enough data and your signals may be unreliable.

---

## Troubleshooting

### "Cannot find external strategy"

- Verify `strategyPath` points to the correct file
- Ensure `strategyName` matches your exported class name exactly (case-sensitive)
- Check that your class is exported with `export class`

### Indicators returning null

- Ensure adequate warmup period
- Validate indicator values before using them

### Strategy not receiving candles

- Check that `mode` is set correctly (`backtest`, `realtime`, etc.)
- Verify exchange configuration is correct
