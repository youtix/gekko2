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

const integerBetween = (field: string, min: number, max: number, reason: string) => {
  const message = `${field} must be an integer between ${min} and ${max} (${reason})`;
  return z.number(message).int(message).min(min, message).max(max, message);
};

// A backtest reads each batch of candles into memory at once, for every pair: 31 days of 1-minute candles is ample.
const MAX_BATCH_SIZE = 31 * 24 * 60;

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
    batchSize: integerBetween(
      'batchSize',
      1,
      MAX_BATCH_SIZE,
      'minutes, 31 days at most: each batch is read into memory at once',
    ).optional(),
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

export const storageSchema = z.strictObject({
  type: z.literal('sqlite'),
  // Bun opens an in-memory database for an empty path: the candles would be lost on exit, without a word
  database: z.string().trim().min(1, 'storage.database must not be empty'),
  insertThreshold: integerAtLeast('storage.insertThreshold', 1).optional(),
});

export const configurationSchema = z
  .object({
    showLogo: z.boolean().default(true),
    watch: watchSchema,
    exchange: z.discriminatedUnion('name', [
      dummyExchangeSchema,
      binanceExchangeSchema,
      hyperliquidExchangeSchema,
      paperBinanceExchangeSchema,
    ]),
    storage: storageSchema.nullable().optional().default(null),
    plugins: z.array(z.looseObject({ name: z.string() })),
    strategy: z.looseObject({ name: z.string() }).optional(),
    [disclaimerField]: z.boolean().nullable().default(null),
  })
  .superRefine((data, ctx) => {
    // Checked here rather than when the storage is first used: the backtest reads its candles from it at once, but a
    // CandleWriter would only need it after the markets are loaded from the exchange.
    const hasCandleWriter = some(data.plugins, { name: 'CandleWriter' });
    if (!data.storage && (data.watch.mode === 'backtest' || hasCandleWriter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['storage'],
        message: `storage is required ${data.watch.mode === 'backtest' ? 'in backtest mode, which reads the candles from it' : 'by the CandleWriter plugin, which writes the candles to it'}`,
      });
    }

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
