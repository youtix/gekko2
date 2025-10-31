import { z } from 'zod';

export const traderSchema = z.object({
  name: z.string().optional(),
});
