import { number, object, string } from 'yup';

const simulationBalanceSchema = object({
  asset: number().min(0).required(),
  currency: number().min(0).required(),
});

export const paperTraderSchema = object({
  name: string().required(),
  simulationBalance: simulationBalanceSchema,
  feeMaker: number().positive().required(),
  feeTaker: number().positive().required(),
  feeUsing: string().oneOf(['maker', 'taker']).required(),
});
