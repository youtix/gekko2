import { z } from 'zod';
import { performanceReporterSchema } from './performanceReporter.schema';

export type PerformanceReporterConfig = z.infer<typeof performanceReporterSchema>;
