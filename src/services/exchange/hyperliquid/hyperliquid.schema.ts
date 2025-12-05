import { z } from 'zod';
import { exchangeSchema } from '../exchange.schema';

export const hyperliquidExchangeSchema = exchangeSchema.extend({
  name: z.literal('hyperliquid'),
  privateKey: z.string().startsWith('0x'),
  walletAddress: z.string().startsWith('0x'),
  sandbox: z.boolean().default(false),
  verbose: z.boolean().default(false),
});
