import Yup from 'yup';
import { performanceReporterSchema } from './performanceReporter.schema';

export type PerformanceReporterConfig = Yup.InferType<typeof performanceReporterSchema>;
