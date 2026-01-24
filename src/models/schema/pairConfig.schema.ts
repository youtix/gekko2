import { TradingPair } from '@models/utility.types';
import { z } from 'zod';

export const symbolSchema = z.custom<TradingPair>().refine(symbol => symbol?.includes('/'), 'Symbol must contain a slash');

export const pairConfigSchema = z.object({
  symbol: symbolSchema,
});

export const pairsSchema = z
  .array(pairConfigSchema)
  .min(1, 'At least one pair is required')
  .max(5)
  .superRefine((pairs, ctx) => {
    if (pairs.length > 5) {
      ctx.addIssue({
        code: 'custom',
        message: `Maximum 5 pairs allowed, found ${pairs.length}`,
      });
    }
  });
