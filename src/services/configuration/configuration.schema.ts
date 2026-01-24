import { pairsSchema } from '@models/schema/pairConfig.schema';
import { binanceExchangeSchema } from '@services/exchange/binance/binance.schema';
import { dummyExchangeSchema } from '@services/exchange/dummy/dummyCentralizedExchange.schema';
import { hyperliquidExchangeSchema } from '@services/exchange/hyperliquid/hyperliquid.schema';
import { paperBinanceExchangeSchema } from '@services/exchange/paper/paperTradingBinanceExchange.schema';
import { toTimestamp } from '@utils/date/date.utils';
import { some } from 'lodash-es';
import { z } from 'zod';
import { TIMEFRAMES } from './configuration.const';

const disclaimerField = 'I understand that Gekko only automates MY OWN trading strategies' as const;

const daterangeSchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
  })
  .transform(({ start, end }) => ({ start: toTimestamp(start), end: toTimestamp(end) }));

const warmupSchema = z
  .object({
    tickrate: z.number().default(1000),
    candleCount: z.number().default(0),
  })
  .default({ tickrate: 1000, candleCount: 0 });

export const watchSchema = z
  .object({
    pairs: pairsSchema,
    timeframe: z.enum(TIMEFRAMES),
    tickrate: z.number().default(1000),
    mode: z.enum(['realtime', 'backtest', 'importer']),
    warmup: warmupSchema,
    daterange: daterangeSchema.optional(),
    batchSize: z.number().optional(),
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
  });

export const storageSchema = z.object({
  type: z.literal('sqlite'),
  database: z.string(),
  insertThreshold: z.number().optional(),
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
    // Paper trading only works in realtime mode
    if (data.exchange.name === 'paper-binance' && data.watch.mode !== 'realtime') {
      ctx.addIssue({
        code: 'custom',
        path: ['exchange', 'name'],
        message: 'Paper trading exchange (paper-binance) can only be used in realtime mode',
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
  });
