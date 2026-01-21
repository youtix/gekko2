import { Asset } from '@models/utility.types';
import z from 'zod';

export const proxySchema = z
  .string()
  .regex(/^(https?|socks5):\/\/.+/, 'Proxy must be a valid URL (http://, https://, or socks5://)')
  .optional();

export const simulationBalanceSchema = z
  .array(
    z.object({
      assetName: z.string(),
      balance: z.number().positive(),
    }),
  )
  .min(1)
  .transform(balance => new Map<Asset, number>(balance.map(b => [b.assetName, b.balance])));

export const exchangeSchema = z.object({
  name: z.string(),
  exchangeSynchInterval: z.number().default(10 * 60 * 1000), // in milliseconds
  orderSynchInterval: z.number().default(20 * 1000), // in milliseconds
});
