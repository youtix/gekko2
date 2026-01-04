import { DEFAULT_SIMULATION_BALANCE } from '@services/exchange/exchange.const';
import { exchangeSchema } from '@services/exchange/exchange.schema';
import z from 'zod';

const simulationBalanceSchema = z
  .object({
    asset: z.number().min(0).default(DEFAULT_SIMULATION_BALANCE.asset),
    currency: z.number().min(0).default(DEFAULT_SIMULATION_BALANCE.currency),
  })
  .default(DEFAULT_SIMULATION_BALANCE);

const feeOverrideSchema = z
  .object({
    maker: z.number().optional(),
    taker: z.number().optional(),
  })
  .optional();

export const paperBinanceExchangeSchema = exchangeSchema.extend({
  name: z.literal('paper-binance'),
  verbose: z.boolean().default(false),
  simulationBalance: simulationBalanceSchema,
  feeOverride: feeOverrideSchema,
});
