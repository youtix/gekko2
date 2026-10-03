import { z } from 'zod';

export const supervisionSchema = z.object({
  name: z.string(),
  token: z.string(),
  botUsername: z.string(),
  cpuThreshold: z.number().positive().default(80),
  memoryThreshold: z.number().positive().default(1024),
  cpuCheckInterval: z.number().positive().default(10000),
  memoryCheckInterval: z.number().positive().default(10000),
  logMonitoringInterval: z.number().positive().default(60000),
  /** How often the candle check looks at the age of the last 1m bucket received */
  candleCheckInterval: z.number().positive().default(60000),
  /** Age of the last 1m bucket beyond which the candle check alerts that the candles stopped coming */
  candleStaleThreshold: z.number().positive().default(180000),
});
