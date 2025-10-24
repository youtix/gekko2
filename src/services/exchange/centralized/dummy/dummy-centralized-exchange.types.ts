import { Action } from '@models/action.types';
import { ExchangeConfig } from '@models/configuration.types';
import { Order } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { MarketLimits } from '../../exchange';

export interface DummyCentralizedExchangeConfig extends ExchangeConfig {
  limits?: MarketLimits;
  portfolio?: Portfolio;
  initialTicker?: Ticker;
  candleTimeframe?: string;
}

export type DummyOrderSide = Action;

export type DummyInternalOrder = Order & {
  side: DummyOrderSide;
  amount: number;
};
