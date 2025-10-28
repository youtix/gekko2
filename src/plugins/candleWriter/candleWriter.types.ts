import { z } from 'zod';
import { candleWriterSchema } from './candleWriter.schema';

export type CandleWriterConfig = z.infer<typeof candleWriterSchema>;
