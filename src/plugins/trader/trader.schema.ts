import { object, string } from 'yup';

export const traderSchema = object({
  name: string().notRequired(),
});
