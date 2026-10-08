import { InputSources } from '@models/inputSources.types';
import { z } from 'zod';

// Unchecked, a period of 0 or 2.5 made the SMA NaN on every candle, and the strategy never traded
export const smaCrossoverStrategySchema = z.strictObject({
  period: z.int().positive(),
  // The close when left out: the SMA's own default, which a block without src always got
  src: z.enum(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'] as const satisfies readonly InputSources[]).default('close'),
});
