import { z } from 'zod';

// each, wait and cancelAfter count candles: whole numbers, and each above 0, as each 0 never advised (index % 0 is NaN)
export const debugAdviceStrategySchema = z.strictObject({
  each: z.number().int().positive(),
  // Left out, the strategy advised from the first candle (undefined > index never holds), as with 0
  wait: z.number().int().nonnegative().default(0),
  // Left out, the strategy never cancels its orders
  cancelAfter: z.number().int().nonnegative().optional(),
  // Read nowhere: the e2e flows pass it where they mean wait. Accepted so that they still run, until they and this schema drop it
  waittime: z.number().optional(),
});
