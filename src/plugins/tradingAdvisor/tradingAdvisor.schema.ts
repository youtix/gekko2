import { number, object, string } from 'yup';
import { TIMEFRAMES } from './tradingAdvisor.const';

export const tradingAdvisorSchema = object({
  name: string().required(),
  strategyName: string().required(),
  timeframe: string().oneOf(TIMEFRAMES).required(),
  windowMode: string().oneOf(['calendar', 'rolling']).default('calendar'),
  historySize: number().required(),
});
