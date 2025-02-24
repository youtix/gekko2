import { MissingBrokerFeatureError } from '@errors/broker/missingBrokerFeature.error';
import { OrderOutOfRangeError } from '@errors/broker/OrderOutRange.error';
import { UndefinedLimitsError } from '@errors/broker/undefinedLimits.error';
import { Action } from '@models/types/action.types';
import { Candle } from '@models/types/candle.types';
import { BrokerConfig } from '@models/types/configuration.types';
import { Order } from '@models/types/order.types';
import { Portfolio } from '@models/types/portfolio.types';
import { Ticker } from '@models/types/ticker.types';
import { Trade } from '@models/types/trade.types';
import { config } from '@services/configuration/configuration';
import { logger } from '@services/logger';
import Big from 'big.js';
import ccxt, { Exchange, ExchangeError, NetworkError } from 'ccxt';
import { isNil } from 'lodash-es';
import {
  BROKER_MAX_RETRIES_ON_FAILURE,
  BROKER_MAX_RETRIES_ON_FAILURE_DELAY,
  INTERVAL_BETWEEN_CALLS_IN_MS,
} from './broker.const';

export abstract class Broker {
  protected broker: Exchange;
  protected brokerName: string;
  protected asset: string;
  protected currency: string;
  protected symbol: string;
  protected interval: number;

  constructor({ name, interval }: BrokerConfig) {
    const { asset, currency } = config.getWatch();
    this.broker = new ccxt[name]();
    if (!this.broker.has['fetchTrades']) throw new MissingBrokerFeatureError(name, 'fetchTrades');
    if (!this.broker.has['fetchOHLCV']) throw new MissingBrokerFeatureError(name, 'fetchOHLCV');
    if (!this.broker.has['fetchBalance']) throw new MissingBrokerFeatureError(name, 'fetchBalance');
    if (!this.broker.has['fetchTicker']) throw new MissingBrokerFeatureError(name, 'fetchTicker');
    if (!this.broker.has['createLimitOrder'])
      throw new MissingBrokerFeatureError(name, 'createLimitOrder');
    this.broker.options['maxRetriesOnFailure'] = 0; // we handle it manualy
    this.brokerName = name;
    this.asset = asset;
    this.currency = currency;
    this.symbol = `${asset}/${currency}`;
    this.interval = interval ?? INTERVAL_BETWEEN_CALLS_IN_MS;
  }

  // Public broker API
  public getBrokerName() {
    return this.brokerName;
  }
  public getInterval() {
    return this.interval;
  }
  public async fetchTicker(): Promise<Ticker> {
    return this.retry<Ticker>(() => this.fetchTickerOnce());
  }
  public async fetchOHLCV(from?: EpochTimeStamp): Promise<Candle[]> {
    return this.retry<Candle[]>(() => this.fetchOHLCVOnce(from));
  }
  public async fetchTrades(): Promise<Trade[]> {
    return this.retry<Trade[]>(() => this.fetchTradesOnce());
  }
  public async fetchPortfolio(): Promise<Portfolio> {
    return this.retry<Portfolio>(() => this.fetchPortfolioOnce());
  }
  public async createLimitOrder(side: Action, amount: number): Promise<Order> {
    return this.retry<Order>(() => this.createLimitOrderOnce(side, amount));
  }
  public async cancelLimitOrder(id: string): Promise<Order> {
    return this.retry<Order>(() => this.cancelLimitOrderOnce(id));
  }
  public async fetchOrder(id: string): Promise<Order> {
    return this.retry<Order>(() => this.fetchOrderOnce(id));
  }

  // Private functions
  private async retry<T>(fn: () => Promise<T>, currRetry = 1): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const isRetryableError = error instanceof NetworkError || error instanceof ExchangeError;
      if (error instanceof Error)
        logger.error(`${this.brokerName} call failed due to ${error.message}`);
      if (!isRetryableError || currRetry > BROKER_MAX_RETRIES_ON_FAILURE) throw error;
      await this.broker.sleep(BROKER_MAX_RETRIES_ON_FAILURE_DELAY);
      return this.retry(fn, currRetry + 1);
    }
  }

  // Protected functions
  protected async calculatePrice(side: Action) {
    const minimalPrice = this.broker.limits.price?.min;
    const maximalPrice = this.broker.limits.price?.max;
    if (isNil(minimalPrice) || isNil(maximalPrice))
      throw new UndefinedLimitsError('price', minimalPrice, maximalPrice);

    const ticker = await this.fetchTicker();
    const price = side === 'buy' ? ticker.bid + minimalPrice : ticker.ask - minimalPrice;
    if (price > maximalPrice || price < minimalPrice)
      throw new OrderOutOfRangeError('price', price, minimalPrice, maximalPrice);
    return price;
  }

  protected async calculateAmount(amount: number) {
    const minimalAmount = this.broker.limits.amount?.min;
    const maximalAmount = this.broker.limits.amount?.max;

    if (isNil(minimalAmount) || isNil(maximalAmount))
      throw new UndefinedLimitsError('amount', minimalAmount, maximalAmount);
    if (amount < minimalAmount) throw new OrderOutOfRangeError('amount', amount, minimalAmount);

    if (amount > maximalAmount) return maximalAmount;
    return amount;
  }

  protected async checkCost(amount: number, price: number) {
    const minimalCost = this.broker.limits.cost?.min;
    const maximalCost = this.broker.limits.cost?.max;

    if (isNil(minimalCost) || isNil(maximalCost))
      throw new UndefinedLimitsError('cost', minimalCost, maximalCost);

    const cost = Big(amount).mul(price);
    if (cost.gt(maximalCost) || cost.lt(minimalCost))
      throw new OrderOutOfRangeError('cost', +cost, minimalCost, maximalCost);
  }

  protected abstract fetchTickerOnce(): Promise<Ticker>;
  protected abstract fetchPortfolioOnce(): Promise<Portfolio>;
  protected abstract fetchOHLCVOnce(from?: EpochTimeStamp): Promise<Candle[]>;
  protected abstract fetchTradesOnce(): Promise<Trade[]>;
  protected abstract createLimitOrderOnce(side: Action, amount: number): Promise<Order>;
  protected abstract cancelLimitOrderOnce(id: string): Promise<Order>;
  protected abstract fetchOrderOnce(id: string): Promise<Order>;
}
