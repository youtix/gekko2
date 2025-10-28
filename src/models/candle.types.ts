import { z } from 'zod';
import { candleSchema } from './schema/candle.schema';

export type Candle = z.infer<typeof candleSchema>;
