import Yup from 'yup';
import { TrailingStop } from '../../services/core/order/trailingStop';
import { paperTraderSchema } from './paperTrader.schema';

export type PapertraderConfig = Yup.InferType<typeof paperTraderSchema>;
export type ActiveStopTrigger = {
  id: string;
  adviceId: string;
  instance: TrailingStop;
};
export type Position = { cost?: number; amount?: number; effectivePrice?: number };
