import { binanceExchangeSchema } from '@services/exchange/centralized/binance/binance.schema';
import { dummyExchangeSchema } from '@services/exchange/centralized/dummy/dummyCentralizedExchange.schema';
import { some } from 'lodash-es';
import { z } from 'zod';
import { TIMEFRAMES } from './configuration.const';

const disclaimerField = 'I understand that Gekko only automates MY OWN trading strategies' as const;

const daterangeSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
});

const warmupSchema = z
  .object({
    tickrate: z.number().default(1000),
    candleCount: z.number().default(0),
  })
  .default({ tickrate: 1000, candleCount: 0 });

export const watchSchema = z
  .object({
    currency: z.string(),
    asset: z.string(),
    tickrate: z.number().default(1000),
    mode: z.enum(['realtime', 'backtest', 'importer']),
    timeframe: z.enum(TIMEFRAMES).default('1m'),
    fillGaps: z.enum(['no', 'empty']).default('empty'),
    warmup: warmupSchema,
    daterange: z.union([daterangeSchema, z.null()]).default(null),
    batchSize: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    const requiresDaterange = data.mode === 'importer' || data.mode === 'backtest';
    if (requiresDaterange && data.daterange === null) {
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
    exchange: z.discriminatedUnion('name', [dummyExchangeSchema, binanceExchangeSchema]),
    storage: storageSchema.nullable().optional().default(null),
    plugins: z.array(z.looseObject({ name: z.string() })),
    strategy: z.looseObject({ name: z.string() }).optional(),
    [disclaimerField]: z.boolean().nullable().default(null),
  })
  .superRefine((data, ctx) => {
    const hasTraderPlugin = some(data.plugins, plugin => plugin.name?.toLowerCase() === 'trader');
    const isUsingRealExchange = data.exchange && !data.exchange.name.includes('dummy') && !data.exchange.sandbox;
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
