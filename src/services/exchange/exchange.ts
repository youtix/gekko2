import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Action } from '@models/action.types';
import { Candle } from '@models/candle.types';
import { OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { config } from '@services/configuration/configuration';
import { isNil } from 'lodash-es';
import { INTERVAL_BETWEEN_CALLS_IN_MS } from './exchange.const';
import { UndefinedLimitsError } from './exchange.error';
import { ExchangeConfig, MarketLimits } from './exchange.types';

export abstract class Exchange {
  protected readonly exchangeName: string;
  protected readonly asset: string;
  protected readonly currency: string;
  protected readonly symbol: string;
  protected readonly interval: number;

  constructor({ name, interval }: ExchangeConfig) {
    const { asset, currency } = config.getWatch();
    this.exchangeName = name;
    this.asset = asset;
    this.currency = currency;
    this.symbol = `${asset}/${currency}`;
    this.interval = interval ?? INTERVAL_BETWEEN_CALLS_IN_MS;
  }

  // Public exchange API
  public getExchangeName() {
    return this.exchangeName;
  }

  public getSymbol() {
    return this.symbol;
  }

  public getInterval() {
    return this.interval;
  }

  // Protected functions
  protected async checkOrderPrice(side: Action) {
    const limits = this.getMarketLimits();
    const priceLimits = limits?.price;
    const minimalPrice = priceLimits?.min;
    const maximalPrice = priceLimits?.max;

    if (isNil(minimalPrice)) throw new UndefinedLimitsError('price', minimalPrice, maximalPrice);

    const ticker = await this.fetchTicker();
    const price = side === 'BUY' ? ticker.bid + minimalPrice : ticker.ask - minimalPrice;
    if (price < minimalPrice) throw new OrderOutOfRangeError('exchange', 'price', price, minimalPrice, maximalPrice);
    if (!isNil(maximalPrice) && price > maximalPrice)
      throw new OrderOutOfRangeError('exchange', 'price', price, minimalPrice, maximalPrice);
    return price;
  }

  protected checkOrderAmount(amount: number) {
    const limits = this.getMarketLimits();
    const amountLimits = limits?.amount;
    const minimalAmount = amountLimits?.min;
    const maximalAmount = amountLimits?.max;

    if (isNil(minimalAmount)) throw new UndefinedLimitsError('amount', minimalAmount, maximalAmount);
    if (amount < minimalAmount)
      throw new OrderOutOfRangeError('exchange', 'amount', amount, minimalAmount, maximalAmount);

    if (!isNil(maximalAmount) && amount > maximalAmount) return maximalAmount;
    return amount;
  }

  protected checkOrderCost(amount: number, price: number) {
    const limits = this.getMarketLimits();
    const costLimits = limits?.cost;
    const minimalCost = costLimits?.min;
    const maximalCost = costLimits?.max;

    if (isNil(minimalCost)) throw new UndefinedLimitsError('cost', minimalCost, maximalCost);

    const cost = amount * price;
    if (cost < minimalCost) throw new OrderOutOfRangeError('exchange', 'cost', cost, minimalCost, maximalCost);
    if (!isNil(maximalCost) && cost > maximalCost)
      throw new OrderOutOfRangeError('exchange', 'cost', cost, minimalCost, maximalCost);
  }

  public abstract loadMarkets(): Promise<void>;
  public abstract fetchTicker(): Promise<Ticker>;
  public abstract getKlines(from?: EpochTimeStamp, timeframe?: string, limits?: number): Promise<Candle[]>;
  public abstract fetchTrades(): Promise<Trade[]>;
  public abstract fetchMyTrades(from?: EpochTimeStamp): Promise<Trade[]>;
  public abstract fetchPortfolio(): Promise<Portfolio>;
  public abstract createLimitOrder(side: Action, amount: number): Promise<OrderState>;
  public abstract createMarketOrder(side: Action, amount: number): Promise<OrderState>;
  public abstract cancelOrder(id: string): Promise<OrderState>;
  public abstract fetchOrder(id: string): Promise<OrderState>;
  protected abstract getMarketLimits(): MarketLimits | undefined;

  public abstract onNewCandle(onNewCandle: (candle: Candle) => void): () => void;
}
