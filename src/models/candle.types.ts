import Yup from 'yup';
import { candleSchema } from './schema/candle.schema';

export type Candle = Yup.InferType<typeof candleSchema>;
