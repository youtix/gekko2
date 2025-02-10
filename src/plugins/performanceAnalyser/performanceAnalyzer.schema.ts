import { number, object, string } from 'yup';

export const performanceAnalyzerSchema = object({
  name: string().required(),
  riskFreeReturn: number().positive().required(),
});
