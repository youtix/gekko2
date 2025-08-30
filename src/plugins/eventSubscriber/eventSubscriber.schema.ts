import { object, string } from 'yup';

export const eventSubscriberSchema = object({
  name: string().required(),
  token: string().required(),
});
