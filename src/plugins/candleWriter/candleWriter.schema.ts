import { z } from 'zod';

export const candleWriterSchema = z.object({ name: z.string() });
