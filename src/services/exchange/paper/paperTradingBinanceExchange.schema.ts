import { exchangeSchema, feeRateSchema, proxySchema, simulationBalanceSchema } from '@services/exchange/exchange.schema';
import z from 'zod';

const feeOverrideSchema = z
  .object({
    maker: feeRateSchema('feeOverride.maker').optional(),
    taker: feeRateSchema('feeOverride.taker').optional(),
  })
  .optional();

export const paperBinanceExchangeSchema = exchangeSchema.extend({
  name: z.literal('paper-binance'),
  verbose: z.boolean().default(false),
  simulationBalance: simulationBalanceSchema,
  feeOverride: feeOverrideSchema,
  proxy: proxySchema,
});
