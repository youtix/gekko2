import { TradingPair } from '@models/utility.types';
import { uniq } from 'lodash-es';
import { z } from 'zod';

export const symbolSchema = z
  .string()
  .refine(symbol => symbol.includes('/'), 'Symbol must contain a slash')
  .transform(symbol => symbol as TradingPair);

export const assetSchema = z
  .string()
  .min(1, 'Asset must not be empty')
  .refine(asset => !asset.includes('/'), 'Asset must not contain a slash');

export const currencySchema = z
  .string()
  .min(1, 'Currency must not be empty')
  .refine(currency => !currency.includes('/'), 'Currency must not contain a slash');

export const assetsSchema = z
  .array(assetSchema)
  .min(1, 'At least one asset is required')
  .max(5, 'Maximum 5 assets allowed')
  .superRefine((assets, ctx) => {
    const repeatedAssets = uniq(assets.filter((asset, index) => assets.indexOf(asset) !== index));
    if (repeatedAssets.length) {
      ctx.addIssue({ code: 'custom', message: `assets must not contain duplicates (repeated: ${repeatedAssets.join(', ')})` });
    }
  });

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
