import z from 'zod';
import { paperBinanceExchangeSchema } from './paperTradingBinanceExchange.schema';

export type PaperTradingBinanceExchangeConfig = z.infer<typeof paperBinanceExchangeSchema>;
