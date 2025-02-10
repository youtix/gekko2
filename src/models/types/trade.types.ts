import Yup from 'yup';
import { tradeSchema } from '../schema/trade.schema';

export type Trade = Yup.InferType<typeof tradeSchema>;
