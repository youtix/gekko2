import z from 'zod';
import { centralizedExchangeSchema } from '../cex.schema';
import { DEFAULT_LIMITS, DEFAULT_SIMULATION_BALANCE, DEFAULT_TICKER } from './dummyCentralizedExchange.const';

const simulationBalanceSchema = z
  .object({
    asset: z.number().min(0).default(DEFAULT_SIMULATION_BALANCE.asset),
    currency: z.number().min(0).default(DEFAULT_SIMULATION_BALANCE.currency),
  })
  .default(DEFAULT_SIMULATION_BALANCE);

const limitsSchema = z
  .object({
    price: z.object({
      min: z.number().default(DEFAULT_LIMITS.price.min),
      max: z.number().default(DEFAULT_LIMITS.price.max),
    }),
    amount: z.object({
      min: z.number().default(DEFAULT_LIMITS.amount.min),
      max: z.number().default(DEFAULT_LIMITS.amount.max),
    }),
    cost: z.object({
      min: z.number().default(DEFAULT_LIMITS.cost.min),
      max: z.number().default(DEFAULT_LIMITS.cost.max),
    }),
  })
  .default(DEFAULT_LIMITS);

const initialTickerSchema = z
  .object({
    bid: z.number().default(DEFAULT_TICKER.bid),
    ask: z.number().default(DEFAULT_TICKER.ask),
  })
  .default(DEFAULT_TICKER);

export const dummyExchangeSchema = centralizedExchangeSchema.extend({
  name: z.literal('dummy-cex'),
  interval: z.number().default(50), // in ms
  feeMaker: z.number().positive().default(0.15), // in %
  feeTaker: z.number().positive().default(0.25), // in %
  simulationBalance: simulationBalanceSchema,
  limits: limitsSchema,
  initialTicker: initialTickerSchema,
});
