import { z } from 'zod';

// Strict, like every plugin schema: a misspelt option must be refused, not dropped in favour of its default (maxConsecutiveError: -1
// would leave the circuit breaker at 5 errors)
export const tradingAdvisorSchema = z.strictObject({
  name: z.string(),
  strategyName: z.string(),
  strategyPath: z.string().optional(),
  maxConsecutiveErrors: z.number().int().min(-1).default(5),
});
