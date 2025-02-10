import { array, number, object } from 'yup';

export const tradeSchema = object({
  timestamp: number().positive().required(),
  price: number().positive().required(),
  amount: number().positive().required(),
});

export const tradesSchema = array().of(tradeSchema);
