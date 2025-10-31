import z from 'zod';
import { centralizedExchangeSchema } from '../cex.schema';

export const binanceExchangeSchema = centralizedExchangeSchema.extend({
  name: z.literal('binance'),
});
