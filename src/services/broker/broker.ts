import { GekkoError } from '@errors/gekko.error';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Action } from '@models/types/action.types';
import { Candle } from '@models/types/candle.types';
import { BrokerConfig } from '@models/types/configuration.types';
import { Order } from '@models/types/order.types';
import { Portfolio } from '@models/types/portfolio.types';
import { Ticker } from '@models/types/ticker.types';
import { Trade } from '@models/types/trade.types';
import { config } from '@services/configuration/configuration';
import { error } from '@services/logger';
import { getRetryDelay } from '@utils/fetch/fetch.utils';
import ccxt, { Exchange, NetworkError } from 'ccxt';
import { each, isNil } from 'lodash-es';
import { BROKER_MANDATORY_FEATURES, BROKER_MAX_RETRIES_ON_FAILURE, INTERVAL_BETWEEN_CALLS_IN_MS } from './broker.const';
import { UndefinedLimitsError } from './broker.error';

export abstract class Broker {
  protected broker: Exchange;
  protected brokerName: string;
  protected asset: string;
  protected currency: string;
  protected symbol: string;
  protected interval: number;

  constructor({ name, interval, key, secret, sandbox, verbose }: BrokerConfig) {
    const { asset, currency } = config.getWatch();
    const ccxtConfig = { ...(key && { apiKey: key }), ...(secret && { secret }), verbose };
    this.broker = new ccxt[name](ccxtConfig);
    const mandatoryFeatures = [...BROKER_MANDATORY_FEATURES, ...(sandbox ? ['sandbox'] : [])];
    each(mandatoryFeatures, feature => {
      if (!this.broker.has[feature]) throw new GekkoError('broker', `Missing ${feature} feature in ${name} broker`);
    });
    this.broker.setSandboxMode(sandbox ?? false);
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
  public async loadMarkets() {
    await this.broker.loadMarkets();
  }
  public async fetchTicker() {
    return this.retry<Ticker>(() => this.fetchTickerOnce());
  }
  public async fetchOHLCV(from?: EpochTimeStamp) {
    return this.retry<Candle[]>(() => this.fetchOHLCVOnce(from));
  }
  public async fetchTrades() {
    return this.retry<Trade[]>(() => this.fetchTradesOnce());
  }
  public async fetchMyTrades(from?: EpochTimeStamp) {
    return this.retry<Trade[]>(() => this.fetchMyTradesOnce(from));
  }
  public async fetchPortfolio() {
    return this.retry<Portfolio>(() => this.fetchPortfolioOnce());
  }
  public async createLimitOrder(side: Action, amount: number) {
    return this.retry<Order>(() => this.createLimitOrderOnce(side, amount));
  }
  public async cancelLimitOrder(id: string) {
    return this.retry<Order>(() => this.cancelLimitOrderOnce(id));
  }
  public async fetchOrder(id: string) {
    return this.retry<Order>(() => this.fetchOrderOnce(id));
  }

  // Private functions
  private async retry<T>(fn: () => Promise<T>, currRetry = 1): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const isRetryableError = err instanceof NetworkError;
      if (err instanceof Error) error('broker', `${this.brokerName} call failed due to ${err.message}`);
      if (!isRetryableError || currRetry > BROKER_MAX_RETRIES_ON_FAILURE) throw err;
      await this.broker.sleep(getRetryDelay(currRetry));
      return this.retry(fn, currRetry + 1);
    }
  }

  // Protected functions
  protected async calculatePrice(side: Action) {
    const minimalPrice = this.broker.market(this.symbol).limits.price?.min;
    const maximalPrice = this.broker.market(this.symbol).limits.price?.max;
    if (isNil(minimalPrice) || isNil(maximalPrice)) throw new UndefinedLimitsError('price', minimalPrice, maximalPrice);

    const ticker = await this.fetchTicker();
    const price = side === 'buy' ? ticker.bid + minimalPrice : ticker.ask - minimalPrice;
    if (price > maximalPrice || price < minimalPrice)
      throw new OrderOutOfRangeError('broker', 'price', price, minimalPrice, maximalPrice);
    return price;
  }

  protected calculateAmount(amount: number) {
    const minimalAmount = this.broker.market(this.symbol).limits.amount?.min;
    const maximalAmount = this.broker.market(this.symbol).limits.amount?.max;

    if (isNil(minimalAmount) || isNil(maximalAmount))
      throw new UndefinedLimitsError('amount', minimalAmount, maximalAmount);
    if (amount < minimalAmount) throw new OrderOutOfRangeError('broker', 'amount', amount, minimalAmount);

    if (amount > maximalAmount) return maximalAmount;
    return amount;
  }

  protected checkCost(amount: number, price: number) {
    const minimalCost = this.broker.market(this.symbol).limits.cost?.min;
    const maximalCost = this.broker.market(this.symbol).limits.cost?.max;

    if (isNil(minimalCost) || isNil(maximalCost)) throw new UndefinedLimitsError('cost', minimalCost, maximalCost);

    const cost = amount * price;
    if (cost > maximalCost || cost < minimalCost)
      throw new OrderOutOfRangeError('broker', 'cost', cost, minimalCost, maximalCost);
  }

  protected abstract cancelLimitOrderOnce(id: string): Promise<Order>;
  protected abstract createLimitOrderOnce(side: Action, amount: number): Promise<Order>;
  protected abstract fetchMyTradesOnce(from?: EpochTimeStamp): Promise<Trade[]>;
  protected abstract fetchOHLCVOnce(from?: EpochTimeStamp): Promise<Candle[]>;
  protected abstract fetchOrderOnce(id: string): Promise<Order>;
  protected abstract fetchPortfolioOnce(): Promise<Portfolio>;
  protected abstract fetchTickerOnce(): Promise<Ticker>;
  protected abstract fetchTradesOnce(): Promise<Trade[]>;
}
