import z from 'zod';
import { binanceExchangeSchema } from './binance.schema';

export type BinanceExchangeConfig = z.infer<typeof binanceExchangeSchema>;

export type BinanceSpotOrder = Partial<{
  orderId: number;
  id: number;
  clientOrderId: string;
  origClientOrderId: string;
  status: string;
  executedQty: string | number;
  origQty: string | number;
  cummulativeQuoteQty: string | number;
  price: string | number;
  updateTime: number;
  transactTime: number;
  time: number;
}>;
