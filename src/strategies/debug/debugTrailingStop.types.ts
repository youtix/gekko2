import { z } from 'zod';
import { debugTrailingStopStrategySchema } from './debugTrailingStop.schema';

export type DebugTrailingStopParams = z.infer<typeof debugTrailingStopStrategySchema>;
