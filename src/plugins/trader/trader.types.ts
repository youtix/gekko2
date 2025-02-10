import Yup from 'yup';
import { traderSchema } from './trader.schema';

export type Trader = Yup.InferType<typeof traderSchema>;
