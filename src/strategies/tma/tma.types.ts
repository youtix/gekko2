import { z } from 'zod';
import { tmaStrategySchema } from './tma.schema';

export type TMAStrategyParams = z.infer<typeof tmaStrategySchema>;
