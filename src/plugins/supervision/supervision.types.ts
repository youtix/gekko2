import { z } from 'zod';
import { supervisionSchema } from './supervision.schema';

export type SupervisionConfig = z.infer<typeof supervisionSchema>;
