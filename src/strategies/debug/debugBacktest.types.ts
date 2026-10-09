import { z } from 'zod';
import { debugBacktestStrategySchema } from './debugBacktest.schema';

export type DebugBacktestParams = z.infer<typeof debugBacktestStrategySchema>;
