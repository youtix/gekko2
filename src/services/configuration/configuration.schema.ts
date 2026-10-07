import { assetsSchema, currencySchema } from '@models/schema/pairConfig.schema';
import { TradingPair } from '@models/utility.types';
import { binanceExchangeSchema } from '@services/exchange/binance/binance.schema';
import { dummyExchangeSchema } from '@services/exchange/dummy/dummyCentralizedExchange.schema';
import { hyperliquidExchangeSchema } from '@services/exchange/hyperliquid/hyperliquid.schema';
import { paperBinanceExchangeSchema } from '@services/exchange/paper/paperTradingBinanceExchange.schema';
import { toTimestamp } from '@utils/date/date.utils';
import { difference, find, some } from 'lodash-es';
import { z } from 'zod';
import { TIMEFRAMES } from './configuration.const';

const disclaimerField = 'I understand that Gekko only automates MY OWN trading strategies' as const;

// js-yaml loads an unquoted timestamp as a Date. An invalid Date is not converted (toISOString() would throw)
// and fails the string check instead.
const isoDatetimeSchema = z.preprocess(
  value => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : value),
  z.iso.datetime(),
);

const daterangeSchema = z
  .strictObject({
    start: isoDatetimeSchema,
    end: isoDatetimeSchema,
  })
  .transform(({ start, end }) => ({ start: toTimestamp(start), end: toTimestamp(end) }));

// Heart throws once two ticks are more than 3 tick periods apart. At 100 ms only an event-loop stall of over 200 ms trips
// it, well clear of ordinary stalls such as a batch of SQLite inserts (up to 80 ms measured on a laptop).
const MIN_TICKRATE = 100;

const integerAtLeast = (field: string, min: number) => {
  const message = `${field} must be an integer of at least ${min}`;
  return z.number(message).int(message).min(min, message);
};

const warmupSchema = z
  .strictObject({
    tickrate: integerAtLeast('warmup.tickrate', MIN_TICKRATE).default(1000),
    candleCount: integerAtLeast('warmup.candleCount', 0).default(0),
  })
  .default({ tickrate: 1000, candleCount: 0 });

export const watchSchema = z
  .strictObject({
    assets: assetsSchema,
    currency: currencySchema,
    timeframe: z.enum(TIMEFRAMES).optional(),
    tickrate: integerAtLeast('tickrate', MIN_TICKRATE).default(1000),
    mode: z.enum(['realtime', 'backtest', 'importer']),
    warmup: warmupSchema,
    daterange: daterangeSchema.optional(),
    batchSize: integerAtLeast('batchSize', 1).optional(),
  })
  .transform(data => ({
    ...data,
    pairs: data.assets.map(asset => ({
      symbol: `${asset}/${data.currency}` as TradingPair,
    })),
  }))
  .superRefine((data, ctx) => {
    if (data.assets.includes(data.currency)) {
      ctx.addIssue({ code: 'custom', path: ['assets'], message: `assets must not contain the currency (${data.currency})` });
    }
  })
  .superRefine((data, ctx) => {
    const requiresDaterange = data.mode === 'importer' || data.mode === 'backtest';
    if (requiresDaterange && !data.daterange) {
      ctx.addIssue({
        code: 'custom',
        path: ['daterange'],
        message: 'daterange is required for importer and backtest modes',
      });
    }
  })
  .superRefine((data, ctx) => {
    if (data.mode !== 'importer' && !data.timeframe) {
      ctx.addIssue({
        code: 'custom',
        path: ['timeframe'],
        message: 'timeframe is required for backtest and realtime modes',
      });
    }
  });

// Storage holds the candles until it has insertThreshold minutes of them (about 1.6 KB a minute for 5 pairs), then writes them in
// one synchronous transaction per pair, which stalls the event loop (measured with 5 pairs: 0.1 s for a day, 0.6 to 1.2 s for a
// week). A day is the most, close to the importer's default of 1000: the Heart of a history download fails after a 0.2 s stall at
// the shortest tickrate, and a run stopped without finalising its plugins (Ctrl-C) loses all that Storage holds. Storage would
// read 0 as left out (1 in realtime, 1000 in the importer), hence the minimum of 1.
const MAX_INSERT_THRESHOLD = 1440;
const insertThresholdMessage = `insertThreshold must be an integer number of minutes between 1 and ${MAX_INSERT_THRESHOLD}`;

export const storageSchema = z.strictObject({
  type: z.literal('sqlite'),
  database: z.string(),
  insertThreshold: z
    .number(insertThresholdMessage)
    .int(insertThresholdMessage)
    .min(1, insertThresholdMessage)
    .max(MAX_INSERT_THRESHOLD, insertThresholdMessage)
    .optional(),
});

export const configurationSchema = z
  .strictObject({
    showLogo: z.boolean().default(true),
    watch: watchSchema,
    exchange: z.discriminatedUnion('name', [
      dummyExchangeSchema,
      binanceExchangeSchema,
      hyperliquidExchangeSchema,
      paperBinanceExchangeSchema,
    ]),
    storage: storageSchema.nullable().optional().default(null),
    // Loose on purpose, unlike the rest of the configuration: the pipeline parses each plugin entry again with the strict schema
    // of the plugin its name selects, and the strategy block is handed whole to the strategy, whose parameters are its own.
    plugins: z.array(z.looseObject({ name: z.string() })),
    strategy: z.looseObject({ name: z.string() }).optional(),
    [disclaimerField]: z.boolean().nullable().default(null),
  })
  .superRefine((data, ctx) => {
    // Only the simulator fills orders from replayed candles: any other exchange, sandbox included, would receive the
    // backtest's orders. The importer needs a real exchange to download candles from.
    const exchangesByMode: Record<typeof data.watch.mode, Array<typeof data.exchange.name>> = {
      backtest: ['dummy-cex'],
      importer: ['binance', 'hyperliquid'],
      realtime: ['binance', 'hyperliquid', 'paper-binance'],
    };
    const allowedExchanges = exchangesByMode[data.watch.mode];
    if (!allowedExchanges.includes(data.exchange.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['exchange', 'name'],
        message: `Exchange ${data.exchange.name} cannot be used in ${data.watch.mode} mode (allowed: ${allowedExchanges.join(', ')})`,
      });
    }

    // Disclaimer validation for real exchanges (exclude dummy-cex and paper-binance)
    const hasTraderPlugin = some(data.plugins, plugin => plugin.name?.toLowerCase() === 'trader');
    const isSimulatedExchange = data.exchange.name === 'dummy-cex' || data.exchange.name === 'paper-binance';
    const isUsingRealExchange = data.exchange && !isSimulatedExchange && !('sandbox' in data.exchange && data.exchange.sandbox);
    const isDisclaimerIgnored = !data[disclaimerField];
    if (hasTraderPlugin && isUsingRealExchange && isDisclaimerIgnored) {
      ctx.addIssue({
        code: 'custom',
        path: [disclaimerField],
        message:
          'These settings enable Trader with a real exchange and may spend real money, leading to severe losses. Confirm by setting the disclaimer sentence to true in the settings app.',
      });
    }

    // marketData is dummy-cex's only source of fees and order limits, looked up by exact symbol: a watched pair without an
    // entry would trade free of both, and an entry for any other symbol (a typo, a swapped asset) would never be read.
    // Zod also runs this refinement after a non-aborting issue (a failed refine or bound), with the transforms that build
    // watch.pairs and the marketData Map skipped, so the rule only checks a configuration that has no other issue.
    if (data.exchange.name === 'dummy-cex' && !ctx.issues.length) {
      const watchedSymbols = data.watch.pairs.map(({ symbol }) => symbol);
      const marketDataSymbols = [...data.exchange.marketData.keys()];
      const missingSymbols = difference(watchedSymbols, marketDataSymbols);
      const unwatchedSymbols = difference(marketDataSymbols, watchedSymbols);
      if (missingSymbols.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['exchange', 'marketData'],
          message: `Each watched pair needs a marketData entry, or dummy-cex fills its orders with no fees and no order limits (missing: ${missingSymbols.join(', ')})`,
        });
      }
      if (unwatchedSymbols.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['exchange', 'marketData'],
          message: `Each marketData symbol must match a watched pair (not watched: ${unwatchedSymbols.join(', ')})`,
        });
      }
    }

    // strategyName selects the strategy class, strategy.name only labels the run (backtest log, PerformanceReporter rows): a
    // strategy block left over from another strategy would file the results under that strategy's name. Plugin entries are
    // loose objects, so a strategyName that is not a string is left to the TradingAdvisor schema, applied by the pipeline.
    const strategyName = find(data.plugins, { name: 'TradingAdvisor' })?.strategyName;
    if (typeof strategyName === 'string' && data.strategy && data.strategy.name !== strategyName) {
      ctx.addIssue({
        code: 'custom',
        path: ['strategy', 'name'],
        message: `strategy.name '${data.strategy.name}' must equal the TradingAdvisor strategyName '${strategyName}', which selects the strategy class`,
      });
    }
  });
