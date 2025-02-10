import { object, string } from 'yup';

export const traderSchema = object({
  name: string().equals(['trader']).notRequired(),
  key: string().notRequired(),
  secret: string().notRequired(),
  username: string().notRequired(),
  passphrase: string().notRequired(),
});
