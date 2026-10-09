import { InputSources } from '@models/inputSources.types';
import { z } from 'zod';

// Unchecked, a misspelt high threshold (hight) compared the RSI with undefined: the strategy bought once and never sold
export const rsiStrategySchema = z.strictObject({
  period: z.int().positive(),
  // The close when left out: the RSI indicator's own default, which a block without src always got
  src: z.enum(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'] as const satisfies readonly InputSources[]).default('close'),
  thresholds: z.strictObject({
    high: z.number(),
    low: z.number(),
    persistence: z.int().nonnegative(),
  }),
});
