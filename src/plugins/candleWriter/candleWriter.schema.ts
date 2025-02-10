import { object, string } from 'yup';

export const candleWriterSchema = object({
  name: string().required(),
});
