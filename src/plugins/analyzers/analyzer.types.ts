import { z } from 'zod';
import { analyzerSchema } from './analyzer.schema';

export type AnalyzerConfig = z.infer<typeof analyzerSchema>;
