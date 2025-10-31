import { z } from 'zod';

export const candleSchema = z.object({
  id: z.number().optional(),
  start: z.number().positive(),
  open: z.number().min(0),
  high: z.number().min(0),
  low: z.number().min(0),
  close: z.number().min(0),
  volume: z.number().min(0),
  volumeActive: z.number().min(0).optional(),
  quoteVolume: z.number().min(0).optional(),
  quoteVolumeActive: z.number().min(0).optional(),
});

export const candlesSchema = z.array(candleSchema);
