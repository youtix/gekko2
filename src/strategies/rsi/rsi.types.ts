import { z } from 'zod';
import { rsiStrategySchema } from './rsi.schema';

export type RSICurrentTrend = {
  duration: number;
  direction: 'high' | 'low' | 'none';
  adviced: boolean;
};

export type RSIStrategyParams = z.infer<typeof rsiStrategySchema>;
