import Yup from 'yup';
import { paperTraderSchema } from './paperTrader.schema';

export type PapertraderConfig = Yup.InferType<typeof paperTraderSchema>;
export type Position = { cost?: number; amount?: number; effectivePrice?: number };
