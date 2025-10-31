import z from 'zod';
import { exchangeSchema } from '../exchange.schema';

export const centralizedExchangeSchema = exchangeSchema.extend({
  key: z.string().optional(),
  secret: z.string().optional(),
  sandbox: z.boolean().default(false),
  verbose: z.boolean().default(false),
});
