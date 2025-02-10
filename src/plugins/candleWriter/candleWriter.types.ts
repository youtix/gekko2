import Yup from 'yup';
import { candleWriterSchema } from './candleWriter.schema';

export type CandleWriterConfig = Yup.InferType<typeof candleWriterSchema>;
