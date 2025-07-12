import { number, object, string } from 'yup';

export const telegramSchema = object({
  name: string().required(),
  token: string().required(),
  chatId: number().required(),
});
