import { number, object, string } from 'yup';

export const tradingAdvisorSchema = object({
  name: string().required(),
  strategyName: string().required(),
  candleSize: number().required(),
  historySize: number().required(),
});
