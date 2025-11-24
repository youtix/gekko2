import z from 'zod';

export const exchangeSchema = z.object({
  name: z.string(),
  exchangeSynchInterval: z.number().default(600000), // in milliseconds
  orderSynchInterval: z.number().default(1), // in minute
});
