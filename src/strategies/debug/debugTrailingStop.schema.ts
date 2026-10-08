import { z } from 'zod';

// trigger and percentage are bounded as the TrailingStopManager checks them once the BUY has filled: out of bounds, the stop was refused
// only then, with a warning, and the position kept no stop
export const debugTrailingStopStrategySchema = z.strictObject({
  /** Number of candles to wait before placing the first order; left out, it is placed on the first candle, as with 0 */
  wait: z.number().int().nonnegative().default(0),
  /** Trailing stop trigger price; left out, the stop is active as soon as it is armed */
  trigger: z.number().positive().optional(),
  /** Trailing stop trailing percentage, above 0 and below 100 */
  percentage: z.number().gt(0).lt(100),
});
