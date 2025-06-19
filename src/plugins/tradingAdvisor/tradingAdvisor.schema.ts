import { object, string } from 'yup';

export const tradingAdvisorSchema = object({
  name: string().required(),
  strategyName: string().required(),
  windowMode: string().oneOf(['calendar', 'rolling']).default('calendar'),
});
