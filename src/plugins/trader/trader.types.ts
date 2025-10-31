import { z } from 'zod';
import { traderSchema } from './trader.schema';

export type Trader = z.infer<typeof traderSchema>;
