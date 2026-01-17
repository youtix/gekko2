import { z } from 'zod';
import { configurationSchema, storageSchema, watchSchema } from '../services/configuration/configuration.schema';

export type Watch = z.infer<typeof watchSchema>;
export type StorageConfig = z.infer<typeof storageSchema>;
export type Configuration = z.infer<typeof configurationSchema>;
export type Pairs = Watch['pairs'];
export type Timeframe = Pairs[number]['timeframe'];
export type Symbol = Pairs[number]['symbol'];
