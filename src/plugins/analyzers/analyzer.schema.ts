import { z } from 'zod';

export const analyzerSchema = z.strictObject({
  name: z.string(),
  // 0 is a legitimate risk-free rate (cash that earns nothing): the Sharpe and Sortino ratios then weigh the bare return against its risk
  riskFreeReturn: z.number().nonnegative().default(5),
  enableConsoleTable: z.boolean().default(false),
});
