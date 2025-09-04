import { array, number, object } from 'yup';

export const candleSchema = object({
  id: number().notRequired(),
  start: number().positive().required(),
  open: number().min(0).required(),
  high: number().min(0).required(),
  low: number().min(0).required(),
  close: number().min(0).required(),
  volume: number().min(0).required(),
  volumeActive: number().min(0).optional(),
  quoteVolume: number().min(0).optional(),
  quoteVolumeActive: number().min(0).optional(),
});

export const candlesSchema = array().of(candleSchema);
