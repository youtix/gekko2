import { z } from 'zod';

export const tradingAdvisorSchema = z.object({
  name: z.string(),
  strategyName: z.string(),
  strategyPath: z.string().optional(),
  maxConsecutiveErrors: z.number().int().min(-1).default(5),
});
