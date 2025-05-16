import { boolean, number, object, string } from 'yup';

export const performanceAnalyzerSchema = object({
  name: string().required(),
  riskFreeReturn: number().positive().required(),
  enableConsoleTable: boolean().default(false),
});
