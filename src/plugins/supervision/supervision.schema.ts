import { number, object, string } from 'yup';

export const supervisionSchema = object({
  name: string().required(),
  token: string().required(),
  botUsername: string().required(),
  cpuThreshold: number().positive().default(80),
  memoryThreshold: number().positive().default(1024),
  cpuCheckInterval: number().positive().default(10000),
  memoryCheckInterval: number().positive().default(10000),
  logMonitoringInterval: number().positive().default(60000),
});
