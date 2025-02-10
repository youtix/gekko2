import Yup from 'yup';
import { tradingAdvisorSchema } from './tradingAdvisor.schema';

export type TradingAdvisorConfiguration = Yup.InferType<typeof tradingAdvisorSchema>;
