# Implementation Blueprint: Multi-Asset Plugin Architecture

This blueprint updates the Gekko2 plugin system to support multi-asset processing, implementing a "Shared Strategy Manager" pattern and specialized Performance Analyzers.

## 1. Core Plugin Architecture
**Goal**: Decouple `Plugin` base class from single-asset assumptions.

*   **File**: `src/plugins/plugin.ts`
*   **Changes**:
    *   `abstract processOneMinuteCandle(candle: Candle)` -> `abstract processOneMinuteCandle(symbol: TradingPair, candle: Candle)`
    *   **Remove properties**: `this.symbol`, `this.asset`, `this.currency` from the base class.
    *   **Configuration**: Plugins will no longer auto-read `config.watch.pairs[0]`. They must accept the `symbol` dynamically or read the full list `config.watch.pairs` if initialization logic (like setting up batchers) requires it.

*   **File**: `src/services/core/stream/plugins.stream.ts`
*   **Changes**:
    *   Update `_write` to pass `symbol` from `SecuredCandleEvent` to `plugin.processInputStream(symbol, candle)`.

## 2. Trading Advisor & Strategy Manager
**Goal**: Centralized strategy logic handling multiple assets simultaneously.

*   **File**: `src/plugins/tradingAdvisor/tradingAdvisor.ts`
*   **Logic**:
    *   Maintain a `Map<TradingPair, CandleBatcher>`.
    *   **Synchronization**:
        *   As 1m candles arrive sequentially (per symbol), feed them into their respective `CandleBatcher`.
        *   When a `CandleBatcher` emits a `TimeframeCandle`, buffer it.
        *   **Trigger**: When *all* active assets have produced a candle for Timeframe `T`, create a `CandleBucket` (Map<Symbol, Candle>).
        *   Call `this.strategyManager.onTimeFrameCandle(candleBucket)`.

*   **File**: `src/strategies/strategyManager.ts`
*   **Changes**:
    *   **State**: Track `age` and `warmup` globally (based on the synchronized tick).
    *   **Input**: Update `onTimeFrameCandle` to accept `CandleBucket`.
    *   **Indicators**: Maintain `Map<TradingPair, Indicator[]>`.
        *   Update `addIndicator` to require a `symbol` argument (e.g., `addIndicator('RSI', 'BTC/USDT', params)`).
    *   **Tools**: Provide the strategy with a `CandleBucket` so it can access `candles['BTC/USDT'].close` and `candles['ETH/USDT'].close`.

## 3. Candle Writer
**Goal**: Write candles to storage with correct table names.

*   **File**: `src/plugins/candleWriter/candleWriter.ts`
*   **Changes**:
    *   Update `processOneMinuteCandle(symbol, candle)` to call `this.getStorage().addCandle(symbol, candle)`.

## 4. Performance Plugins
**Goal**: Split monolithic analysis into specialized plugins.

### A. PortfolioAnalyzer (Refactor of `PerformanceAnalyzer`)
This is the "General Purpose" analyzer for multi-asset or simple P&L tracking.
*   **Metrics**: Total Portfolio Value, Sharpe Ratio, Sortino, Max Drawdown (Global).
*   **Logic**:
    *   Listen to `onPortfolioChange`.
    *   Listen to `onOrderCompleted` (to update trade history/fees).
    *   Ignore specific "trade pairs"; focus on the `balance` timeline.
*   **Output**: A concise "Portfolio Report".

### B. RoundTripAnalyzer (New/Refactor)
This tracks specific "Enter -> Exit" trades.
*   **Logic**:
    *   Maintain a queue of "Open Positions" per symbol.
    *   Match `BUY` orders with subsequent `SELL` orders (FIFO or LIFO approach to be decided, usually FIFO).
    *   Calculate discrete profit per roundtrip.
*   **Metrics**: Win Rate, Average Trade Profit, Profit Factor.

## 5. Execution Steps

1.  **Core Refactor**: Update `Plugin` base class and `PluginsStream` signature. (Fixing compile errors immediately in all subclasses).
2.  **Simple Plugins**: Update `CandleWriter` to match new signature.
3.  **Strategy Refactor**:
    *   Update `TradingAdvisor` to handle Map of Batchers.
    *   Update `StrategyManager` types to `CandleBucket`.
4.  **Performance Separation**:
    *   Rename `PerformanceAnalyzer` -> `PortfolioAnalyzer`.
    *   Create `RoundTripAnalyzer`.
    *   Update `PerformanceReporter` to handle reports from both.
