import { z } from 'zod';
import { debugRealtimeStrategySchema } from './debugRealtime.schema';

export type DebugRealtimeParams = z.infer<typeof debugRealtimeStrategySchema>;
