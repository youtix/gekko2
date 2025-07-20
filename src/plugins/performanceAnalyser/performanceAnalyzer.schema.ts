import { boolean, number, object, string } from 'yup';

export const performanceAnalyzerSchema = object({
  name: string().required(),
  riskFreeReturn: number().positive().default(5),
  enableConsoleTable: boolean().default(false),
});
