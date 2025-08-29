import { number, object, string } from 'yup';

export const eventSubscriberSchema = object({
  name: string().required(),
  token: string().required(),
  strategyLogLimit: number().default(50),
});
