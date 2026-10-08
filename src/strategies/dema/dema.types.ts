import { z } from 'zod';
import { demaStrategySchema } from './dema.schema';

export type DEMAStrategyParams = z.infer<typeof demaStrategySchema>;
