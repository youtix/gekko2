import z from 'zod';
import { centralizedExchangeSchema } from '../cex.schema';

const simulationBalanceSchema = z.object({
  asset: z.number().min(0).default(0),
  currency: z.number().min(0).default(1000),
});

const limitsSchema = z.object({
  price: z.object({
    min: z.number().default(1),
    max: z.number().default(1_000_000),
  }),
  amount: z.object({
    min: z.number().default(0.0001),
    max: z.number().default(1_000),
  }),
  cost: z.object({
    min: z.number().default(10),
    max: z.number().default(1_000_000),
  }),
});

const initialTickerSchema = z.object({
  bid: z.number().default(100),
  ask: z.number().default(101),
});

export const dummyExchangeSchema = centralizedExchangeSchema.extend({
  name: z.literal('dummy-cex'),
  feeMaker: z.number().positive().default(0.15),
  feeTaker: z.number().positive().default(0.25),
  simulationBalance: simulationBalanceSchema,
  limits: limitsSchema,
  initialTicker: initialTickerSchema,
});
