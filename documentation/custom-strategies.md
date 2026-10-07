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
  IndicatorResults,
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

  onTimeframeCandleAfterWarmup(params: OnCandleEventParams<MyStrategyParams>, ...indicators: IndicatorResults[]): void {
    // Your main trading logic goes here
  }

  // Every hook is optional, the two above included: keep only the ones you use
  onEachTimeframeCandle(params: OnCandleEventParams<MyStrategyParams>, ...indicators: IndicatorResults[]): void {}
  log(params: OnCandleEventParams<MyStrategyParams>, ...indicators: IndicatorResults[]): void {}
  onOrderCompleted(params: OnOrderCompletedEventParams<MyStrategyParams>, ...indicators: IndicatorResults[]): void {}
  onOrderCanceled(params: OnOrderCanceledEventParams<MyStrategyParams>, ...indicators: IndicatorResults[]): void {}
  onOrderErrored(params: OnOrderErroredEventParams<MyStrategyParams>, ...indicators: IndicatorResults[]): void {}
  end(): void {}
}
```

### 2. Create Your Configuration File

Create a YAML configuration file (e.g., `config.yaml`):

```yaml
watch:
  assets: [BTC]
  currency: USDT
  mode: backtest
  timeframe: 1h
  warmup:
    candleCount: 100
  daterange:
    start: 2024-01-01
    end: 2024-12-31

exchange:
  name: dummy-cex
  marketData:
    - symbol: BTC/USDT
      marketData:
        price:
          min: 0.01
          max: 1000000
        amount:
          min: 0.00001
          max: 9000
        cost:
          min: 5
          max: 9000000
        precision: # Decimals of a price and of an amount, a whole number (8 = steps of 0.00000001), not a step like 0.01
          price: 8
          amount: 8
        fee:
          maker: 0.0004
          taker: 0.0007
  simulationBalance:
    - assetName: BTC
      balance: 0
    - assetName: USDT
      balance: 1000

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

  - name: RoundTripAnalyzer
    enableConsoleTable: true
```

### 3. Run Your Strategy

```bash
# Using the compiled executable
GEKKO_CONFIG_FILE_PATH=./config.yaml ./dist/gekko2
```

---

## Strategy Interface

Every custom strategy must implement the `Strategy<T>` interface, where `T` is your parameters type:

```typescript
// Every hook is optional. candle is a Map holding the candle of every watched pair, and each indicator arrives as an
// IndicatorResults, { results: unknown; symbol: TradingPair }, in the order of the addIndicator calls.
// TrailingStopState comes from '@strategies/trailingStopManager.types', UUID from 'node:crypto'.
interface Strategy<T> {
  init?(params: InitParams<T>): void;
  onEachTimeframeCandle?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  onTimeframeCandleAfterWarmup?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  log?(params: OnCandleEventParams<T>, ...indicators: IndicatorResults[]): void;
  onOrderCompleted?(params: OnOrderCompletedEventParams<T>, ...indicators: IndicatorResults[]): void;
  onOrderCanceled?(params: OnOrderCanceledEventParams<T>, ...indicators: IndicatorResults[]): void;
  onOrderErrored?(params: OnOrderErroredEventParams<T>, ...indicators: IndicatorResults[]): void;
  // The price reached the trigger of a trailing stop (see Creating Orders), or, without a trigger, the stop was just armed: trailing starts
  onTrailingStopActivated?(state: TrailingStopState): void;
  // A trailing stop was hit: orderId is the MARKET SELL Gekko has just created for it, whose outcome arrives like any order's
  onTrailingStopTriggered?(orderId: UUID, state: TrailingStopState): void;
  end?(): void;
}
```

---

## Lifecycle Methods

### `init` — Strategy Initialization

Called **once** when the first candle arrives. Use this to register indicators: `addIndicator(name, symbol, params)` is only available here.

```typescript
init({ candle, tools, addIndicator }: InitParams<MyParams>): void {
  // candle holds one candle per watched pair: pick the pair to follow, and keep it for the other hooks
  const [pair] = candle.keys();
  this.pair = pair;
  // Register indicators (they'll be updated automatically)
  addIndicator('EMA', pair, { period: tools.strategyParams.short });
  addIndicator('EMA', pair, { period: tools.strategyParams.long });
}
```

> [!IMPORTANT]
> Indicators are passed to other methods in the **same order** you register them in `init`, each as a `{ results, symbol }` object.

---

### `onEachTimeframeCandle` — Every Candle (Including Warmup)

Called on **every** timeframe candle from the very beginning, including during warmup.

```typescript
onEachTimeframeCandle({ candle, portfolio, tools }: OnCandleEventParams<MyParams>, ...indicators: IndicatorResults[]): void {
  // Track data even during warmup (candle is a Map: one candle per watched pair)
  const current = this.pair ? candle.get(this.pair) : undefined;
  if (current) this.priceHistory.push(current.close);
}
```

---

### `onTimeframeCandleAfterWarmup` — Trading Logic (After Warmup)

Called on each timeframe candle **after** the warmup period completes. **This is where your main trading logic belongs.**

```typescript
onTimeframeCandleAfterWarmup({ candle, portfolio, tools }: OnCandleEventParams<MyParams>, ...indicators: IndicatorResults[]): void {
  const { createOrder, log, strategyParams } = tools;
  const [shortEma, longEma] = indicators;
  // results is unknown, and null until the indicator has seen enough candles
  if (!this.pair || typeof shortEma.results !== 'number' || typeof longEma.results !== 'number') return;

  if (shortEma.results > longEma.results && this.position !== 'long') {
    log('info', 'EMA crossover detected — going LONG');
    createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
    this.position = 'long';
  }
}
```

---

### `log` — Logging Hook

Called on each timeframe candle after warmup, just before `onTimeframeCandleAfterWarmup`, to log indicator values and debug info.

```typescript
log({ candle, tools }: OnCandleEventParams<MyParams>, ...indicators: IndicatorResults[]): void {
  const [shortEma, longEma] = indicators;
  if (typeof shortEma.results !== 'number' || typeof longEma.results !== 'number') return;
  tools.log('debug', `EMA Short: ${shortEma.results.toFixed(2)} | Long: ${longEma.results.toFixed(2)}`);
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
  // Not 'error': tools.log('error', …) throws, and stops the bot
  tools.log('warn', `Order ${order.id} failed: ${order.reason}`);
  // Implement retry logic if needed
}
```

---

### `end` — Strategy Cleanup

Called when the strategy ends (backtest completes, or the bot stops on an error or on its circuit breaker; Ctrl-C skips it).

```typescript
end(): void {
  // Cleanup resources, log final statistics, etc.
}
```

---

## Tools Available

Every lifecycle method but `end` and the trailing-stop hooks receives a `tools` object with utilities:

| Tool                  | Type                           | Description                                                                                                                        |
|-----------------------|--------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| `strategyParams`      | `T` (your params type)         | Your strategy parameters from config                                                                                               |
| `marketData`          | `Map<TradingPair, MarketData>` | Order limits, precision (as steps: 0.01) and fees of each watched pair, plus the narrower `market` limits of MARKET orders if any  |
| `log`                 | `(level, msg) => void`         | Log messages (`debug`, `info`, `warn`, `error`); `error` also throws a `GekkoError`, which stops the bot                           |
| `createOrder`         | `(order) => UUID`              | Create a new order: returns its id at once, the outcome arrives later in `onOrderCompleted`, `onOrderCanceled` or `onOrderErrored` |
| `cancelOrder`         | `(orderId) => void`            | Cancel an existing order                                                                                                           |
| `cancelTrailingOrder` | `(orderId) => void`            | Drop the trailing stop of a BUY order (given the BUY's id), before or after the BUY completes                                      |

---

## Using Indicators

Register indicators in `init` with `addIndicator(name, symbol, params)` and receive their values in candle handlers:

```typescript
init({ candle, addIndicator }: InitParams<MyParams>): void {
  const [pair] = candle.keys();
  // Indicators are calculated automatically on each candle of the pair they follow
  addIndicator('SMA', pair, { period: 20 });
  addIndicator('RSI', pair, { period: 14 });
  addIndicator('MACD', pair, { short: 12, long: 26, signal: 9 });
}

onTimeframeCandleAfterWarmup(params: OnCandleEventParams<MyParams>, ...indicators: IndicatorResults[]): void {
  // Access in the same order you registered them, each as { results, symbol }: results is unknown, and null until the
  // indicator has seen enough candles (macd.results is an object, { macd, signal, hist }, whose values start as null)
  const [sma, rsi, macd] = indicators;
  const price = params.candle.get(sma.symbol)?.close;
  if (price === undefined || typeof sma.results !== 'number' || typeof rsi.results !== 'number') return;

  if (rsi.results < 30 && price > sma.results) {
    // Buy signal logic
  }
}
```

See the [Indicators Documentation](./indicators.md) for all available indicators.

---

## Creating Orders

Use `tools.createOrder()` to place trades:

### Order Types

| Type       | Description                                                                                                                                                                   |
|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `STICKY`   | Limit order `price.min` inside the best bid/ask, re-placed every `orderSynchInterval` once the market moves past it (realtime only); no timeout, never becomes a market order |
| `MARKET`   | Immediate market order                                                                                                                                                        |
| `LIMIT`    | Standard limit order at specified price                                                                                                                                       |

### Order Parameters

```typescript
// tools.createOrder(order: StrategyOrder): UUID returns the order id at once. The outcome arrives later, in
// onOrderCompleted, onOrderCanceled or onOrderErrored, whose order.id is that id.
type StrategyOrder = {
  symbol: TradingPair;                  // The watched pair to trade, e.g. 'BTC/USDT'
  type: 'STICKY' | 'MARKET' | 'LIMIT';
  side: 'BUY' | 'SELL';
  amount?: number;                      // Optional: specific amount (defaults to full balance)
  price?: number;                       // LIMIT orders: the limit price (the last close when omitted)
  // Optional, BUY orders only (ignored on a SELL): a trailing stop armed when the BUY completes, which then sells the
  // amount bought with a MARKET order
  trailing?: {
    percentage: number;                 // Distance of the stop below the highest price since activation, above 0 and below 100 (2.5 for 2.5%)
    trigger?: number;                   // Price above 0 that activates it (active at once when omitted); other values are refused at arming
  };
};
```

### Examples

```typescript
// Full position market buy
createOrder({ symbol: 'BTC/USDT', type: 'MARKET', side: 'BUY' });

// Specific amount sticky sell
createOrder({ symbol: 'BTC/USDT', type: 'STICKY', side: 'SELL', amount: 0.5 });

// Limit order at specific price
createOrder({ symbol: 'BTC/USDT', type: 'LIMIT', side: 'BUY', price: 42000, amount: 0.1 });

// Full position market buy, then a stop trailing 2.5% below the highest price once the price reaches 45000.
// Keep the id: tools.cancelTrailingOrder(orderId) drops the stop.
const orderId = createOrder({ symbol: 'BTC/USDT', type: 'MARKET', side: 'BUY', trailing: { percentage: 2.5, trigger: 45000 } });
```

---

## Configuration File

### TradingAdvisor Plugin Configuration

The key configuration for custom strategies is in the `TradingAdvisor` plugin, here for the [Complete Example](#complete-example) below:

```yaml
plugins:
  - name: TradingAdvisor
    strategyName: EMACrossover    # Must match your exported class name
    strategyPath: ./strategies/emaCrossover.strategy.ts  # Path to your strategy file
```

| Parameter      | Type   | Required | Description                              |
|----------------|--------|----------|------------------------------------------|
| `strategyName` | string | Yes      | The exact name of your exported class    |
| `strategyPath` | string | Yes      | Path to your strategy file (relative or absolute) |

### Strategy Parameters

The whole `strategy:` block, `name` included, is passed to your strategy as `tools.strategyParams` (Gekko only validates `name`, so a misspelt parameter is simply `undefined`). For the [Complete Example](#complete-example), whose `EMACrossoverParams` declares `src`, `shortPeriod` and `longPeriod`:

```yaml
strategy:
  name: EMACrossover       # Must equal the TradingAdvisor strategyName; labels the run
  src: close               # Accessible via tools.strategyParams.src
  shortPeriod: 12          # Accessible via tools.strategyParams.shortPeriod
  longPeriod: 26           # Accessible via tools.strategyParams.longPeriod
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
import { TradingPair } from '@models/utility.types';
import {
  IndicatorResults,
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { UUID } from 'node:crypto';

interface EMACrossoverParams {
  src: 'close' | 'open' | 'high' | 'low';
  shortPeriod: number;
  longPeriod: number;
}

export class EMACrossover implements Strategy<EMACrossoverParams> {
  // createOrder only returns the order's id: its outcome arrives later, through the order hooks, so the position is only known
  // then. Until then the order is pending, and no other one is sent.
  private position: 'long' | 'none' = 'none';
  private pendingOrderId?: UUID;
  private pair?: TradingPair;

  init({ candle, addIndicator, tools }: InitParams<EMACrossoverParams>): void {
    const { src, shortPeriod, longPeriod } = tools.strategyParams;
    // candle holds one candle per watched pair: this strategy trades the first one
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('EMA', pair, { period: shortPeriod, src });
    addIndicator('EMA', pair, { period: longPeriod, src });
  }

  onTimeframeCandleAfterWarmup(
    { candle, tools }: OnCandleEventParams<EMACrossoverParams>,
    ...indicators: IndicatorResults[]
  ): void {
    const { log, createOrder } = tools;
    const [shortEma, longEma] = indicators;

    if (!this.pair || this.pendingOrderId) return;
    const current = candle.get(this.pair);
    // results is unknown, and null until the EMA has seen enough candles
    if (!current || typeof shortEma.results !== 'number' || typeof longEma.results !== 'number') return;

    // Golden cross: short EMA crosses above long EMA, and nothing is held
    if (shortEma.results > longEma.results && this.position === 'none') {
      log('info', `Golden cross at ${current.close} — BUY signal`);
      this.pendingOrderId = createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
    }
    // Death cross: short EMA crosses below long EMA, and the BUY has completed
    else if (shortEma.results < longEma.results && this.position === 'long') {
      log('info', `Death cross at ${current.close} — SELL signal`);
      this.pendingOrderId = createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
    }
  }

  log({ tools }: OnCandleEventParams<EMACrossoverParams>, ...indicators: IndicatorResults[]): void {
    const [shortEma, longEma] = indicators;
    if (typeof shortEma.results === 'number' && typeof longEma.results === 'number') {
      tools.log('debug', `EMA(short): ${shortEma.results.toFixed(2)} | EMA(long): ${longEma.results.toFixed(2)}`);
    }
  }

  onOrderCompleted({ order }: OnOrderCompletedEventParams<EMACrossoverParams>): void {
    if (order.id !== this.pendingOrderId) return;
    this.pendingOrderId = undefined;
    this.position = order.side === 'BUY' ? 'long' : 'none';
  }

  // Canceled or errored: the position stays as it was, and a later candle may send the order again
  onOrderCanceled({ order }: OnOrderCanceledEventParams<EMACrossoverParams>): void {
    if (order.id === this.pendingOrderId) this.pendingOrderId = undefined;
  }

  onOrderErrored({ order }: OnOrderErroredEventParams<EMACrossoverParams>): void {
    if (order.id === this.pendingOrderId) this.pendingOrderId = undefined;
  }

  // The other hooks are optional, and left out
}
```

`createOrder` returns before the exchange has seen the order: `onOrderCompleted`, `onOrderCanceled` or `onOrderErrored` tells later what became of it, with the id `createOrder` returned. This is why the example keeps that id, and only moves `position` once the order has completed.

### Configuration File: `ema-crossover-config.yaml`

```yaml
showLogo: false

watch:
  assets: [BTC]
  currency: USDT
  mode: backtest
  timeframe: 1h
  warmup:
    candleCount: 200
  daterange:
    start: 2024-01-01
    end: 2024-12-31

exchange:
  name: dummy-cex
  marketData:
    - symbol: BTC/USDT
      marketData:
        price:
          min: 0.01
          max: 1000000
        amount:
          min: 0.00001
          max: 9000
        cost:
          min: 5
          max: 9000000
        precision: # Decimals of a price and of an amount, a whole number (8 = steps of 0.00000001), not a step like 0.01
          price: 8
          amount: 8
        fee:
          maker: 0.0004
          taker: 0.0007
  simulationBalance:
    - assetName: BTC
      balance: 0
    - assetName: USDT
      balance: 1000

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

  - name: RoundTripAnalyzer
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

An indicator's `results` is typed `unknown` and stays `null` until the indicator has seen enough candles, after warmup too if the warmup is shorter than the indicator needs:

```typescript
const [ema] = indicators;
if (typeof ema.results !== 'number' || !Number.isFinite(ema.results)) return;
```

### 3. Track State Properly

Use class properties to track position state and avoid duplicate signals:

```typescript
private currentTrend?: 'up' | 'down';

onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<MyParams>, ...indicators: IndicatorResults[]): void {
  const [shortEma, longEma] = indicators;
  if (typeof shortEma.results !== 'number' || typeof longEma.results !== 'number') return;
  const signal = shortEma.results > longEma.results ? 'up' : 'down';

  // Only act on trend changes
  if (signal === 'up' && this.currentTrend !== 'up') {
    this.currentTrend = 'up';
    tools.createOrder({ type: 'STICKY', side: 'BUY', symbol: shortEma.symbol });
  }
}
```

### 4. Use Appropriate Log Levels

| Level   | Use For                                                            |
|---------|--------------------------------------------------------------------|
| `debug` | Indicator values, calculation details                              |
| `info`  | Trade signals, important state changes                             |
| `warn`  | Recoverable issues, edge cases                                     |
| `error` | Fatal failures only: it throws a `GekkoError`, which stops the bot |

### 5. Set Adequate Warmup

Your warmup period should be at least as long as your longest indicator period:

```yaml
watch:
  warmup:
    candleCount: 100  # If using SMA(50), use at least 50
```

> [!WARNING]
> If warmup is too short, indicators will not have enough data and your signals may be unreliable.

---

## Troubleshooting

### "Cannot find module" or "Cannot find external … strategy"

Gekko loads the strategy as it starts: it imports the file at `strategyPath` (a relative path is resolved against the directory Gekko is started from, not against the config file), then takes the export named `strategyName` from it. A failure stops Gekko with exit code 1, and the log says which step failed:

- `Cannot find module '/home/user/strategies/myStrategy.strategy.ts' from '…'`: there is no file at that path (`strategyPath` once resolved).
  - Verify `strategyPath` points to the correct file
  - For a relative `strategyPath`, check the directory Gekko is started from, or use an absolute path
- `[TRADING ADVISOR] Cannot find external MyStrategy strategy in /home/user/strategies/myStrategy.strategy.ts`: the file was loaded, but exports nothing under the name `strategyName`.
  - Ensure `strategyName` matches your exported class name exactly (case-sensitive)
  - Check that your class is exported with `export class` (an `export default` class is not found)
- `[TRADING ADVISOR] Cannot find internal MyStrategy strategy`: `strategyPath` is missing, so Gekko looked for a built-in strategy of that name.
- A parse error that names no file, such as `BuildMessage: Expected ")" but found end of file`: the strategy file has a syntax error.

### Indicators returning null

- Ensure adequate warmup period
- Validate indicator values before using them

### Strategy not receiving candles

- Check that `mode` is set correctly (`backtest`, `realtime`, etc.)
- Verify exchange configuration is correct
