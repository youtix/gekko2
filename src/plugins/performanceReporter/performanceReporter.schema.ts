import { z } from 'zod';

export const performanceReporterSchema = z.object({
  name: z.string(),
  filePath: z.string().default(process.cwd()),
  fileName: z.string().default('performance_reports.csv'),
});
