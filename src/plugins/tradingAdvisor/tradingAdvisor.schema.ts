import { object, string } from 'yup';

export const tradingAdvisorSchema = object({
  name: string().required(),
  strategyName: string().required(),
  strategyPath: string().optional(),
});
