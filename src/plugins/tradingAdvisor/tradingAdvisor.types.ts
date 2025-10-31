import { z } from 'zod';
import { tradingAdvisorSchema } from './tradingAdvisor.schema';

export type TradingAdvisorConfiguration = z.infer<typeof tradingAdvisorSchema>;
