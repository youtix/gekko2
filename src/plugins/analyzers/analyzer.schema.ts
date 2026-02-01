import { z } from 'zod';

export const analyzerSchema = z.object({
  name: z.string(),
  riskFreeReturn: z.number().positive().default(5),
  enableConsoleTable: z.boolean().default(false),
});
