import z from 'zod';

export const exchangeSchema = z.object({
  name: z.string(),
  exchangeSynchInterval: z.number().default(10 * 60 * 1000), // in milliseconds
  orderSynchInterval: z.number().default(2000), // in milliseconds
});
