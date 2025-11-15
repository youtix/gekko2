import z from 'zod';

export const exchangeSchema = z.object({
  name: z.string(),
  exchangeSynchInterval: z.number().default(10), // in minute
  orderSynchInterval: z.number().default(1), // in minute
});
