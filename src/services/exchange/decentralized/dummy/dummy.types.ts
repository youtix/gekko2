import { Action } from '@models/action.types';
import { ExchangeConfig } from '@models/configuration.types';
import { Order } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { MarketLimits } from '../../exchange';
import { NetworkConfiguration } from '../dex';

export interface DummyExchangeConfig extends ExchangeConfig {
  limits?: MarketLimits;
  portfolio?: Portfolio;
  initialTicker?: Ticker;
  networkConfiguration?: NetworkConfiguration;
  candleTimeframe?: string;
}

export type DummyOrderSide = Action;

export type DummyInternalOrder = Order & {
  side: DummyOrderSide;
  amount: number;
};
