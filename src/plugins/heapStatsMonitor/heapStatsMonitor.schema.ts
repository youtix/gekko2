import { array, number, object, string } from 'yup';

export const heapStatsMonitorSchema = object({
  name: string().required(),
  interval: number().positive().integer().default(1),
  metrics: array().of(string()).optional(),
});
