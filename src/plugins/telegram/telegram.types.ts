import Yup from 'yup';
import { telegramSchema } from './telegram.schema';

export type TelegramConfig = Yup.InferType<typeof telegramSchema>;
