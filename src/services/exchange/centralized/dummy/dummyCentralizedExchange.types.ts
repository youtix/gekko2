import { Action } from '@models/action.types';
import { ExchangeConfig } from '@models/configuration.types';
import { Order } from '@models/order.types';
import { Ticker } from '@models/ticker.types';
import { MarketLimits } from '@services/exchange/exchange.types';

export interface DummyCentralizedExchangeConfig extends ExchangeConfig {
  limits?: MarketLimits;
  initialTicker?: Ticker;
}

export type DummyOrderSide = Action;

export type DummyInternalOrder = Order & {
  side: DummyOrderSide;
  amount: number;
};
