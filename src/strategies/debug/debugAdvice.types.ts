import { z } from 'zod';
import { debugAdviceStrategySchema } from './debugAdvice.schema';

export type DebugAdviceParams = z.infer<typeof debugAdviceStrategySchema>;
