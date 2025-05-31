import { object, string } from 'yup';

export const performanceReporterSchema = object({
  name: string().required(),
  filePath: string().default(process.cwd()),
  fileName: string().default('performance_reports.csv'),
});
