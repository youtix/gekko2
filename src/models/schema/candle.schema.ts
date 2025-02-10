import { array, number, object } from 'yup';

export const candleSchema = object({
  id: number().notRequired(),
  start: number().positive().required(),
  open: number().positive().required(),
  high: number().positive().required(),
  low: number().positive().required(),
  close: number().positive().required(),
  volume: number().positive().required(),
});

export const candlesSchema = array().of(candleSchema);
