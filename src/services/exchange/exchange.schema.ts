import z from 'zod';

export const exchangeSchema = z.object({
  name: z.string(),
  interval: z.number().default(1000),
});
