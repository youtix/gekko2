import { object, string } from 'yup';

export const telegramSchema = object({
  name: string().required(),
  token: string().required(),
  chatId: string().required(),
});
