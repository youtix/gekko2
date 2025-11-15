import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { Minute, Nullable } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { isNil } from 'lodash-es';
import { UndefinedLimitsError } from './exchange.error';
import { MarketLimits } from './exchange.types';

export abstract class Exchange {
  protected readonly exchangeName: string;
  protected readonly asset: string;
  protected readonly currency: string;
  protected readonly exchangeSynchInterval: Minute;
  protected readonly orderSynchInterval: Minute;

  constructor() {
    const { asset, currency } = config.getWatch();
    const { name, exchangeSynchInterval, orderSynchInterval } = config.getExchange();
    this.exchangeName = name;
    this.asset = asset;
    this.currency = currency;
    this.exchangeSynchInterval = exchangeSynchInterval;
    this.orderSynchInterval = orderSynchInterval;
  }

  // Public exchange API
  public getExchangeName() {
    return this.exchangeName;
  }

  public getIntervals() {
    return { orderSync: this.orderSynchInterval, exchangeSync: this.exchangeSynchInterval };
  }

  // Protected functions
  protected async checkOrderPrice(price: number) {
    const limits = this.getMarketLimits();
    const priceLimits = limits?.price;
    const minimalPrice = priceLimits?.min;
    const maximalPrice = priceLimits?.max;

    if (!isNil(minimalPrice) && price < minimalPrice)
      throw new OrderOutOfRangeError('exchange', 'price', price, minimalPrice, maximalPrice);

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

    if (!isNil(maximalAmount) && amount > maximalAmount)
      throw new OrderOutOfRangeError('exchange', 'amount', amount, minimalAmount, maximalAmount);

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
  /** fetch all trades made by the user */
  public abstract fetchMyTrades(from?: EpochTimeStamp): Promise<Trade[]>;
  public abstract fetchPortfolio(): Promise<Portfolio>;
  public abstract createLimitOrder(side: OrderSide, amount: number, price: number): Promise<OrderState>;
  public abstract createMarketOrder(side: OrderSide, amount: number): Promise<OrderState>;
  public abstract cancelOrder(id: string): Promise<OrderState>;
  public abstract fetchOrder(id: string): Promise<OrderState>;
  public abstract getMarketLimits(): Nullable<MarketLimits>;

  public abstract onNewCandle(onNewCandle: (candle: Candle) => void): () => void;
}
