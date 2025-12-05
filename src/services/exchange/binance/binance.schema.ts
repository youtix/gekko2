import { exchangeSchema } from '@services/exchange/exchange.schema';
import z from 'zod';

export const binanceExchangeSchema = exchangeSchema.extend({
  name: z.literal('binance'),
  apiKey: z.string(),
  secret: z.string(),
  sandbox: z.boolean().default(false),
  verbose: z.boolean().default(false),
});
