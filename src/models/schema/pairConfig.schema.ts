import { Symbol } from '@models/utility.types';
import { TIMEFRAMES } from '@services/configuration/configuration.const';
import { z } from 'zod';

export const symbolSchema = z.custom<Symbol>().refine(symbol => symbol?.includes('/'), 'Symbol must contain a slash');

export const pairConfigSchema = z.object({
  symbol: symbolSchema,
  timeframe: z.enum(TIMEFRAMES),
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
