# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Gekko 2 is a modular crypto trading bot framework written in TypeScript and run with Bun. It covers candle import, backtesting, screening/alerting, paper trading and live trading through CCXT (Binance, Hyperliquid). There is one entry point, `src/gekko2.ts`; what it does is decided entirely by a config file.

## Commands

Bun is the package manager and the runtime. Scripts, git hooks and CI all go through `bun` and `bun.lock`; `package-lock.json` is not used by any of them.

```bash
bun install
bun run dev              # run the bot from source (src/gekko2.ts)
bun run build:exec       # compile a standalone binary to dist/gekko2
bun run type:check       # tsc --noEmit, covers src/ and test/
bun run lint:check       # eslint ./src          (bun run lint autofixes)
bun run format:check     # prettier over src/    (bun run format writes)
bun run test             # unit tests: vitest over src/**/*.test.ts
bun run test src/utils/collection/fifo.test.ts                  # one file
bun run test src/utils/collection/fifo.test.ts -t "peek reads"  # one test, by name
bun run test:coverage    # what pre-push and CI run; fails below 80% lines/functions/branches/statements
bun run test:e2e         # test/e2e on Bun's own test runner; not run by CI or hooks
bun run bench            # vitest benchmarks (src/**/*.bench.ts)
```

`bun test` without `run` is Bun's test runner, not vitest. Only `test/e2e` is written for it.

### Running the bot

There are no CLI flags, only two environment variables:

- `GEKKO_CONFIG_FILE_PATH`: the config file to load (`.yml`, `.yaml`, `.json` or `.json5`). Its `watch.mode` (`importer`, `backtest` or `realtime`) selects what runs.
- `GEKKO_LOG_LEVEL`: winston level (`error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`; case-insensitive, `warning` means `warn`). It defaults to `error`, so set `info` or `debug` to see anything. An unknown value falls back to `error` and says so once.

Bun loads `.env` and then `.env.local` (gitignored, takes precedence) automatically, so a bare `bun run dev` runs whatever config those files point at. A variable set on the command line wins over both:

```bash
GEKKO_CONFIG_FILE_PATH=./config/backtest.yml GEKKO_LOG_LEVEL=info bun run dev
```

A backtest replays 1-minute candles from SQLite and aborts if any minute of `watch.daterange` is missing, so the range has to be imported first (importer mode, e.g. `config/importer.yml`, writing to the gitignored `db/`). The importer only stores closed minutes: a `daterange.end` at or after the minute in progress is clamped to the last closed minute, with a warning. An import overwrites the stored candles of its range (the other modes keep what is stored), so re-importing a range repairs the synthetic candles a realtime run's gap filler wrote there.

Exit codes: 0 when a run ends normally or is stopped by `ApplicationStopError`, 1 after any other failure. A run that ends normally still exits 1 if a promise rejection went unhandled along the way.

## Git workflow

- Commit messages must follow Conventional Commits. commitlint enforces it in the `commit-msg` hook and on pull requests: subject not capitalised, header at most 125 characters.
- `pre-commit` runs `type:check` and lint-staged (eslint --fix, prettier); `pre-push` runs `test:coverage`.
- Work lands on `development`. `main` only moves for releases: every push to `main` runs semantic-release, which writes `CHANGELOG.md` and publishes the GitHub release, so never bump a version or edit the changelog by hand.
- semantic-release uses its default Angular preset. A breaking change needs a `BREAKING CHANGE:` footer; `feat!:` on its own releases nothing.
- CI runs on pushes and pull requests to `main` and `development`: `format:check`, `lint:check`, `type:check`, `test:coverage`, `build:exec`.

## Code conventions

- `console.*` is a lint error. Log through `debug`, `info`, `warning` and `error` from `@services/logger`, each taking `(tag, message)`; `tag` is a closed union in `src/models/tag.types.ts`.
- Import cycles are lint errors, and unused parameters must be prefixed with `_`.
- Prettier: 140 columns, single quotes, trailing commas, no parentheses around a lone arrow parameter.
- The path aliases (`@constants`, `@models`, `@errors`, `@utils`, `@services`, `@indicators`, `@strategies`, `@plugins`) are declared in `tsconfig.json` and copied by hand into `vitest.config.ts`. A new alias goes in both.
- Files are named `<name>.<role>.ts` (`.types`, `.schema`, `.const`, `.error`, `.utils`, `.strategy`, `.indicator`, `.stream`, `.mock`, `.bench`). Coverage skips `.schema`, `.mock`, `.types`, `.error`, `.const` and `index.ts` files. `src/utils` has no barrel files; import `@utils/<dir>/<file>`.
- `lodash-es` (never `lodash`), `date-fns` and zod v4 are used throughout. There is no decimal library; rounding goes through `round` and `addPrecise` in `src/utils/math`. Timestamps are epoch milliseconds.
- The list of timeframes exists three times and must be kept in sync: `TIMEFRAMES` (`src/services/configuration/configuration.const.ts`), `TIMEFRAME_TO_MINUTES` (`src/constants/timeframe.const.ts`) and `CandleSize` (`src/services/core/batcher/candleBatcher/candleBatcher.types.ts`).

## Architecture

### Boot and pipeline

`src/gekko2.ts` calls `gekkoPipeline()` (`src/services/core/pipeline/pipeline.ts`), which threads the configured plugin list through a fixed sequence of steps: backtest date-range check, read each plugin class's static configuration, mode compatibility, per-plugin zod parse, dependency and duplicate-emitter checks, `exchange.loadMarkets()`, instantiate, wire events, inject services, then launch the stream pipeline for the mode.

Two module-level singletons sit under everything:

- `config` (`src/services/configuration/configuration.ts`) reads the config file and validates it with zod at import time, and throws if `GEKKO_CONFIG_FILE_PATH` is unset. `configuration.schema.ts` is the source of truth for the config shape. Every section is a `z.strictObject` except the `strategy` block and the `plugins[]` entries, which the plugin's own strict schema parses, so an unknown key anywhere (a misspelt `sandbox`, say) refuses the file. An invalid file is a one-line `GekkoError` naming the file and listing every issue with its path; an invalid plugin entry is reported the same way, with the plugin's name and index.
- `inject` (`src/services/injecter/injecter.ts`) lazily creates and memoises the `exchange()` and `storage()` instances that streams, orders and plugins share. `closeStorage()` closes the storage only if one was created.

`src/gekko2.ts` imports the configuration, the injecter and the pipeline dynamically inside the `try` of `main()`, so that a configuration error is reported like any other failure; a static import that loads `config` would throw before the handlers exist, so do not add one. It is also the only place that reports a fatal error and decides the exit code. Its `catch` and its two process-level handlers share one formatter: a `GekkoError` is logged as its one-line message (stack at debug level), anything else with its name, message and stack, and causes are appended. An `uncaughtException` (for example `Heart` failing to tick after the machine slept) is logged and exits 1 at once, without finalising the plugins. An `unhandledRejection` is logged and sets the exit code to 1 but does not stop the bot, because timer-driven tasks float promises that reject on a network blip.

### Candle streams

Data moves as 1-minute `CandleBucket`s (`Map<TradingPair, Candle>`, one candle for every watched pair) through Node object-mode streams assembled in `src/services/core/pipeline/pipeline.utils.ts`:

| Mode     | Chain                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| realtime | warmup history, then live per-pair streams synchronised by timestamp → RejectFutureCandle → RejectDuplicateCandle → FillCandleGap → PluginsStream |
| backtest | SQLite reader → PluginsStream                                                                                                                     |
| importer | exchange OHLCV history → RejectFutureCandle → FillCandleGap → PluginsStream                                                                       |

A history range (`HistoricalCandleStream`) is inclusive on both ends, so equal bounds mean one minute. The realtime pipeline reads the clock once: the warmup history runs from the start of the candle `warmup.candleCount` candles before the one in progress (`getCandleStart`, on calendar boundaries for `1M`, `3M`, `6M` and `1y`) to the minute before the one in progress, and every live `RealtimeStream` starts at the minute in progress. Each stream keeps a cursor and, on every tick, fetches its pair's closed minutes since the cursor, oldest first, so a late tick catches up instead of skipping a minute and no minute is fetched twice. The realtime gap filler drops, with a warning, every bucket that lacks a pair it has never seen a candle for, so the plugins only ever get complete buckets; the importer lets such buckets through.

Aggregation to `watch.timeframe` is not a stream stage. It happens inside the TradingAdvisor plugin (`CandleBucketBatcher`), which throws if a bucket is missing any watched pair.

For every bucket, `PluginsStream` (`src/services/core/stream/plugins.stream.ts`) does three things in order: the simulated exchange, if one is configured, consumes the bucket and fills orders; every plugin's `processOneMinuteBucket` runs concurrently; then the deferred events are flushed plugin by plugin, in config order.

### Plugins (`src/plugins`)

A plugin extends `Plugin`, implements `processInit`, `processOneMinuteBucket` and `processFinalize`, and exposes a static `getStaticConfiguration()` returning `{ name, schema, modes, dependencies, inject, eventsHandlers, eventsEmitted }`. `tradingAdvisor/tradingAdvisor.ts` is a good reference.

- Registry: the exports of `plugins/index.ts`. `plugins[].name` in the config must equal the exported class name exactly; an unknown name is refused with the list of valid names. The entry is parsed by the plugin's zod `schema` (a `z.strictObject`: a misspelt or retired option is an error, not a silent default) and the result is the constructor argument.
- Wiring is by name: an emitted event `orderCompleted` is bound to the `onOrderCompleted` method of every plugin that has one. Handlers are discovered on the prototype, so they must be methods, not arrow-function properties. Event names live in `src/constants/event.const.ts`, payload types in `src/models/event.types.ts`.
- An event can have only one emitting plugin. `PortfolioAnalyzer` and `RoundTripAnalyzer` both emit `performanceReport`, so they cannot be configured together.
- Delivery is deferred: plugins queue events with `addDeferredEmit(name, payload)` (the payload is `structuredClone`d) and handlers receive an array of payloads when the queue is flushed after the bucket. Nothing is flushed after `processFinalize`, so events sent from there use `emit` directly and carry a single payload.
- Config order matters. The flush is one pass over the plugins in config order, so an event queued on a plugin that was already flushed is delivered with the next bucket, one minute later. Keep `TradingAdvisor`, then `Trader`, then analyzers and reporters.
- Order reports are asynchronous (the order classes settle through callbacks or polls). In backtest the Trader waits for its pending reports before its queue is flushed and again in `processFinalize`, so a fill reaches the strategy and the analyzers in the bucket it happened in, the last one included. In realtime they float and arrive with a later bucket.
- Services named in `inject` (`exchange`, `storage`) are set after construction: use `getExchange()`/`getStorage()` from `processInit` onwards, not in the constructor.
- Modes: TradingAdvisor, Trader, PortfolioAnalyzer and RoundTripAnalyzer run in realtime and backtest; PerformanceReporter in backtest only; CandleWriter in realtime and importer; EventSubscriber and Supervision (both Telegram) in realtime only. Both take an optional `chatId` (`0` is refused); without it the bot warns at start-up, drops what was queued while Gekko was down, binds itself to the first chat that sends it a command from then on (logged at info with whose chat it is) and never rebinds, and anything sent before that is dropped. Each bot needs its own token (two pollers on one token get 409s).

The trading loop for one bucket: TradingAdvisor builds the timeframe candle and calls the strategy → `strategyCreateOrder` → Trader creates a `MARKET`, `LIMIT` or `STICKY` order (`src/services/core/order`) → `orderInitiated`, later one of `orderCompleted` / `orderCanceled` / `orderErrored`, plus `portfolioChange` → back into the strategy's order hooks and into the analyzers → `roundtripCompleted`, `performanceReport`. Strategies track their pending orders through those three terminal events, so every order has to end in one of them.

`ApplicationStopError` is the graceful stop (the circuit breaker): plugins are finalised, the reason is logged at error level and the process exits with code 0, so that a restart-on-failure supervisor leaves it stopped. Any other exception thrown by a plugin or a handler finalises the plugins and ends the process with exit code 1. `PluginsStream` destroys itself with the error it caught, which is how `main` tells the two apart, and it also finalises the plugins that were initialised when a stream upstream fails. There are no SIGINT/SIGTERM handlers, so Ctrl-C skips `processFinalize`.

### Strategies (`src/strategies`)

A strategy is a plain class, constructed without arguments, that implements any of the optional hooks of `Strategy<Params>` (`strategy.types.ts`). `StrategyManager` drives it. Model a new one on an existing strategy such as `dema/`, or on the Complete Example of `documentation/custom-strategies.md`, whose TypeScript examples type-check again.

- On each timeframe candle: `init` (first candle only, and the only place `addIndicator(name, symbol, params)` is available), indicators update, `onEachTimeframeCandle`, then once warmup is over `log` and `onTimeframeCandleAfterWarmup`.
- Hooks get `candle` as a `Map` holding every watched pair, followed by one `{ results, symbol }` argument per indicator in `addIndicator` order. Results are typed `unknown` and stay `null` until the indicator has enough data. `watch.warmup.candleCount` counts timeframe candles and is unrelated to indicator periods, so always null-check.
- Realtime prefetches the warmup candles from the exchange. A backtest spends the first `candleCount` candles of its `daterange` on warmup.
- `tools.createOrder()` returns a UUID immediately; the outcome arrives later through `onOrderCompleted`, `onOrderCanceled` or `onOrderErrored`. Omitting `amount` means all-in. `trailing` only applies to BUY orders: the stop is armed when the BUY completes, `onTrailingStopActivated` fires when the price reaches `trigger` (at arming when there is no trigger), and `StrategyManager` sends the MARKET SELL itself when the stop is hit; a `percentage` outside (0, 100) or a `trigger` that is not a finite positive number is refused at arming with a warning. The Trader caps every SELL to the asset's last synchronized free balance, with a warning, so a live fee taken in the base asset does not get the stop's SELL refused.
- `tools.log('error', …)` throws a `GekkoError`. It is not just a log call.
- `maxConsecutiveErrors` consecutive `orderErrored` events (a TradingAdvisor option, default 5, `-1` disables) raise `ApplicationStopError`.
- The class is chosen by the TradingAdvisor plugin's `strategyName`: the exported class name in `strategies/index.ts`, or with `strategyPath` a named export of an external file. The top-level `strategy:` block is handed to the strategy whole as `tools.strategyParams`. Its `name` selects nothing but labels the run (backtest log, PerformanceReporter rows), so the schema requires it to equal `strategyName`. The rest of the block is not validated, so a misspelt parameter is silently `undefined`.
- Every built-in strategy tracks its position and its pending order (`isLong`, `buyOrderId`, `sellOrderId`, `isPendingOrder` and the three order hooks): it buys only when flat and sells only when long, never while an order of its own is pending, and it starts flat, so a holding present at start-up is sold only by the first SELL after a BUY. Gekko 1 discarded a repeated same-side advice; Gekko 2 relays every advice, so a strategy without that tracking re-advises an all-in BUY on every candle of a trend until the refusals trip the breaker.
- A new built-in strategy is `strategies/<x>/<x>.strategy.ts`, `<x>.types.ts` and `<x>.test.ts`, plus an export in `strategies/index.ts`.

`src/strategies/custom/` holds private, local-only strategies. The directory is gitignored except for a tracked placeholder `index.ts`, which the `preinstall` script marks `assume-unchanged` so local edits never show up in git. Never stage or commit anything from it. Tests in it run with a local `bun run test` but not in CI.

### Indicators (`src/indicators`)

An indicator extends `Indicator<Name>` (`onNewCandle`, `getResult`) and declares its types by augmenting the global `IndicatorRegistry` interface in its `<x>.types.ts` with `{ input, output }`. The registry key, the class name and the export in `indicators/index.ts` must be identical, because the runtime lookup is `indicators[name]`. A new moving-average kind also has to be added to `MovingAverageTypes`/`MovingAverageClasses` (`indicator.types.ts`) and to the three copies of `MOVING_AVERAGES` (bollingerBands, efi, stochastic).

### Exchanges, orders and storage

- `exchange.name` picks the implementation, through a zod discriminated union and a switch in the injecter: `binance` and `hyperliquid` use `CCXTExchange` (`sandbox: true` for testnets; the hyperliquid client is created with `builderFee: false`, otherwise ccxt signs a builder-fee approval at the first order and attaches a 1 bp fee to every one); `dummy-cex` is `DummyCentralizedExchange`, the backtest simulator; `paper-binance` trades simulated orders on live Binance data. A new CCXT exchange needs its schema, a union entry, an injecter case and a `LIMITS` entry in `src/services/exchange/exchange.const.ts`.
- The schema ties the exchange to the mode: backtest takes `dummy-cex` only, importer takes `binance` or `hyperliquid`, realtime takes `binance`, `hyperliquid` or `paper-binance`.
- The simulator's clock is the close of the last candle. It keeps one order book per pair. Limit orders fill in full once a candle's low/high reaches their price, market orders fill at the last close, and there are no partial fills or slippage. Fees and order limits come from `exchange.marketData`, which must hold exactly one entry per watched pair. Its `precision` is given as a number of decimals (`8`) that the schema converts to a step (`1e-8`), because `MarketData.precision` holds steps everywhere else, as ccxt reports them. `MarketData.market`, when present (Binance `MARKET_LOT_SIZE`), narrows the amount range of MARKET orders; `CCXTExchange` and the simulator refuse such an order before sending it.
- Order classes are event emitters. In backtest they settle through exchange callbacks; in realtime, paper trading included, they poll `fetchOrder` every `orderSynchInterval`.
- Trader on a real, non-sandbox exchange is refused unless the config sets `'I understand that Gekko only automates MY OWN trading strategies': true`.
- Storage is `SQLiteStorage` on `bun:sqlite`, the only Bun-specific API in `src/`. It keeps one table of 1-minute candles per pair (`CANDLES_<ASSET>_<CURRENCY>`, upper-cased and always quoted in SQL, so tickers such as `1INCH` work), and `storage.database` is a path relative to the working directory. The `storage` section is ignored unless the mode is backtest or a `CandleWriter` plugin is configured.

## Testing

- Unit tests are colocated `*.test.ts` files. Vitest runs them under Node, not Bun, so anything importing `bun:sqlite` has to be mocked. There are no globals: import `describe`, `it`, `expect` and `vi` from `vitest`.
- Because `config` is built at import time, tests mock `@services/configuration/configuration` (`{ config }`), usually together with `@services/logger` and `@services/injecter/injecter`. Use `vi.hoisted` for values the mock factories refer to.
- `mockReset: true` and `restoreMocks: true` are set globally and both run before each test, ahead of the `beforeEach` hooks. `mockReset` resets every mock: an implementation passed as `vi.fn(impl)` survives, anything chained afterwards (`.mockReturnValue`, `.mockImplementation`), at module scope or inside a `vi.mock` factory, is wiped. `restoreMocks` puts the original back in place of every `vi.spyOn` spy and detaches the spy; it leaves `vi.fn()`, `vi.mock` factories and automocks alone. So set return values in `beforeEach`, create spies in `beforeEach` or in the test itself, never at module scope, in a `describe` body or in `beforeAll` (a detached spy passes `not.toHaveBeenCalled()` without testing anything), and do not call `vi.clearAllMocks()`.
- `src/gekko2.ts` runs `await main()` when it is imported, and `instanceof` checks break across `vi.resetModules()`. Its test resets the modules, imports the file dynamically in each test, and imports the error classes dynamically after the reset.
- A mock that gets called with `new` must be `vi.fn(function () { … })`; an arrow function throws.
- Indicator tests push an ordered `it.each` table through one stateful instance. Rows depend on the ones before them, so a single row cannot be run alone.
- House rules, from `.agent/skills/unit-test-craftsman/SKILL.md`: tagged-template `it.each` tables for repetitive cases; one `expect` per `it`; cover every branch of the file under test (the enforced floor is 80% overall); finish with `bun run type:check` and `bun run test <file>`.
- `test/e2e` runs the whole pipeline for each mode on `bun:test`, with `mock.module` replacing CCXT, the config and winston, an in-memory SQLite database and a sped-up clock. A realtime test never ends its pipeline by itself (nothing exits the process), so each realtime flow file calls `trackRealtimeRuns()` next to its mocks and `endRealtimeRun()` in `afterEach` (`test/e2e/helpers/realtimeRun.helper.ts`), which finalises the plugins and stops the order polls that would otherwise leak into the next test.

## Stale docs and example configs

`README.md` and `documentation/*.md` predate the multi-asset refactor. `quick-start.md`, `modes.md`, `plugins.md`, `built-in-strategies.md` and `custom-strategies.md` (YAML and TypeScript examples alike) have been brought up to date and their examples validate; `README.md` was only patched where a fix touched it. When a doc and the code disagree, trust the zod schemas (`configuration.schema.ts`, `src/plugins/**/*.schema.ts`, `src/services/exchange/**/*.schema.ts`) and `strategy.types.ts`. The usual traps when copying from an older doc or config:

- `watch.asset` is now `watch.assets: [...]`, and `exchange.key` is `apiKey`.
- `simulationBalance` is a list of `{ assetName, balance }`.
- Strategy parameters sit directly under `strategy:`, not under `params:`.
- The `PerformanceAnalyzer` plugin no longer exists; use `PortfolioAnalyzer` or `RoundTripAnalyzer`.
- `addIndicator` takes `(name, symbol, params)`.
- Every section but `strategy` refuses unknown keys, so a retired or misspelt one (`asset`, `fillGaps`, `tickRate`, `sandBox`) is an error, not a silent default. `tickrate` and `warmup.tickrate` are integers of at least 100 ms; `storage.insertThreshold` is an integer number of minutes between 1 and 1440.
- A dummy-cex example without `exchange.marketData` is incomplete: a backtest needs one entry per watched pair (`config/backtest.yml` and `documentation/modes.md` have complete blocks).

In `config/`, `backtest.yml`, `importer.yml` and `realtime-writer.yml` validate as they are. The other `realtime-*.yml` files validate once their credentials are filled in, `realtime-trader.yml` also once its disclaimer is set to `true`.
