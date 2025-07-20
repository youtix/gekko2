import { number, object, string } from 'yup';

const simulationBalanceSchema = object({
  asset: number().min(0).default(0),
  currency: number().min(0).default(1000),
});

export const paperTraderSchema = object({
  name: string().required(),
  simulationBalance: simulationBalanceSchema,
  feeMaker: number().positive().default(0.15),
  feeTaker: number().positive().default(0.25),
  feeUsing: string().oneOf(['maker', 'taker']).default('taker'),
});
