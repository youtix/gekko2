import { Asset, TradingPair } from '@models/utility.types';
import { z } from 'zod';

export const symbolSchema = z.custom<TradingPair>().refine(symbol => symbol?.includes('/'), 'Symbol must contain a slash');

export const assetSchema = z.custom<Asset>().refine(asset => asset && !asset.includes('/'), 'Asset must not contain a slash');

export const currencySchema = z
  .custom<Asset>()
  .refine(currency => currency && !currency.includes('/'), 'Currency must not contain a slash');

export const assetsSchema = z.array(assetSchema).min(1, 'At least one asset is required').max(5, 'Maximum 5 assets allowed');

export const pairConfigSchema = z.object({
  symbol: symbolSchema,
});

export const pairsSchema = z
  .array(pairConfigSchema)
  .min(1, 'At least one pair is required')
  .max(5)
  .superRefine((pairs, ctx) => {
    if (pairs.length > 5) {
      ctx.addIssue({
        code: 'custom',
        message: `Maximum 5 pairs allowed, found ${pairs.length}`,
      });
    }
  });
