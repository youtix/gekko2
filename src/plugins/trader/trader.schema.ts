import { z } from 'zod';

export const traderSchema = z.object({
  name: z.string().optional(),
  portfolioUpdates: z
    .object({
      /** Percentage change required to emit (e.g., 1 for 1%) */
      threshold: z.number().min(0),
      /** Value in quote currency below which an asset is ignored (e.g., 1 for $1) */
      dust: z.number().min(0),
    })
    .optional(),
});
