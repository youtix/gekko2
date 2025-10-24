import { ExchangeConfig } from '@models/configuration.types';

export type ExchangeNames = ExchangeConfig['name'];

export interface ExchangeDataLimits {
  candles?: number;
  trades?: number;
  myTrades?: number;
}
