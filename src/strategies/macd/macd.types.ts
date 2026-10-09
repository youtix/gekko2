import { z } from 'zod';
import { macdStrategySchema } from './macd.schema';

export type MACDStrategyParams = z.infer<typeof macdStrategySchema>;

export type MACDTrend = { duration: number; persisted: boolean; direction: 'up' | 'down' | 'none'; adviced: boolean };
