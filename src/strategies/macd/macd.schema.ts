import { z } from 'zod';

// The fields of the MACD indicator's result, one of which the strategy compares with its thresholds
type MACDOutputKey = keyof NonNullable<IndicatorRegistry['MACD']['output']>;

// Unchecked, macdSrc: histogram read a field the MACD does not have, and the strategy never traded
export const macdStrategySchema = z
  .strictObject({
    short: z.int().positive(),
    long: z.int().positive(),
    signal: z.int().positive(),
    macdSrc: z.enum(['macd', 'signal', 'hist'] as const satisfies readonly MACDOutputKey[]),
    thresholds: z.strictObject({
      up: z.number(),
      down: z.number(),
      persistence: z.int().nonnegative(),
    }),
  })
  // MACD(26, 12) is −MACD(12, 26): swapped periods traded the opposite signal, and equal ones gave a MACD of 0, which never traded.
  // Zod still runs the refinement after a failed bound: a period below 1, already reported, is not compared.
  .refine(({ short, long }) => short < 1 || long < 1 || short < long, {
    message: 'short must be below long (swapped periods give the opposite MACD, equal ones a MACD of 0)',
  });
