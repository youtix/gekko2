import { z } from 'zod';
import { smaCrossoverStrategySchema } from './smaCrossover.schema';

export type SMACrossoverStrategyParams = z.infer<typeof smaCrossoverStrategySchema>;
