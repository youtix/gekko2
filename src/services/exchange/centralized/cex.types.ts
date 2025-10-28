import z from 'zod';
import { centralizedExchangeSchema } from './cex.schema';

export type CentralizedExchangeConfig = z.infer<typeof centralizedExchangeSchema>;
