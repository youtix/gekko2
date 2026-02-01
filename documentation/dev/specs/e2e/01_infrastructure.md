# E2E Step 1: Infrastructure & Mocks

## Goal
Establish the foundational testing environment required to run deterministic end-to-end tests for Gekko2. This includes the test runner configuration, network interception, time manipulation, and synthetic data generation.

## 1. Test Runner Configuration
We will use **Vitest** as the test runner, keeping stack consistency.

### `vitest.e2e.config.ts`
Create a separate configuration file to isolate E2E tests from unit tests.
- **Include**: `src/**/*.e2e.test.ts`
- **Setup Files**: `src/tests/e2e/setup.ts` (Global setup for MSW, etc.)
- **Threads**: Disable parallelism if necessary for database isolation, or use unique DB files per thread.

## 2. Network Mocking (MSW)
Since Gekko2 uses `ccxt` (REST API) and does not use WebSockets for this implementation, we will use **MSW (Mock Service Worker)** to intercept all outgoing HTTP requests.

### Implementation
- **Handlers**: Create handlers for common Exchange APIs (Binance, Kraken, etc.).
  - `GET /api/v3/klines` (Candles)
  - `GET /api/v3/account` (Balance)
  - `POST /api/v3/order` (Trade execution)
- **Passthrough**: Allow local requests if needed, block all other external traffic to ensure tests are offline-capable.

## 3. Time Management
To test "Realtime" strategies without waiting hours, we will use **Vitest Fake Timers**.
- `vi.useFakeTimers()` to control `Date.now()`, `setTimeout`, and `setInterval`.
- **Clock Helper**: Create a helper `advanceTime(seconds: number)` that advances the system time and triggers necessary tick loops if they are driven by `setInterval`.

## 4. Configuration Injection
E2E tests must run with specific configurations (e.g., using an in-memory DB, specific pairs).
- **Strategy**: Instead of writing files to disk, we will start the application instance (Class/Function) passing a **Configuration Object** directly, bypassing the `config/*.yml` loader if possible, or mocking the ConfigService to return our object.
- **Fallback**: If code dependency is too high on files, write temporary `config.e2e-{id}.yml` files.

## 5. Data Generator
A utility to generate deterministic market data.
- `generateCandles(startPrice, count, pattern: 'bull' | 'bear' | 'sideways' | 'volatile')`
- Returns an array of OHLCV candles formatted for `ccxt` and Internal Models.
