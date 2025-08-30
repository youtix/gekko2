import { GekkoError } from '@errors/gekko.error';
import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Action } from '@models/action.types';
import { Candle } from '@models/candle.types';
import { ExchangeConfig } from '@models/configuration.types';
import { Order } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { config } from '@services/configuration/configuration';
import { error, warning } from '@services/logger';
import { getRetryDelay } from '@utils/fetch/fetch.utils';
import ccxt, { Exchange as CCXTExchange, NetworkError } from 'ccxt';
import { each, isNil } from 'lodash-es';
import {
  BROKER_MANDATORY_FEATURES,
  BROKER_MAX_RETRIES_ON_FAILURE,
  INTERVAL_BETWEEN_CALLS_IN_MS,
} from './exchange.const';
import { UndefinedLimitsError } from './exchange.error';

export abstract class Exchange {
  protected exchange: CCXTExchange;
  protected exchangeName: string;
  protected asset: string;
  protected currency: string;
  protected symbol: string;
  protected interval: number;

  constructor({ name, interval, key, secret, sandbox, verbose }: ExchangeConfig) {
    const { asset, currency } = config.getWatch();
    const ccxtConfig = { ...(key && { apiKey: key }), ...(secret && { secret }), verbose };
    this.exchange = new ccxt[name](ccxtConfig);
    const mandatoryFeatures = [...BROKER_MANDATORY_FEATURES, ...(sandbox ? ['sandbox'] : [])];
    each(mandatoryFeatures, feature => {
      if (!this.exchange.has[feature])
        throw new GekkoError('exchange', `Missing ${feature} feature in ${name} exchange`);
    });
    this.exchange.setSandboxMode(sandbox ?? false);
    this.exchange.options['maxRetriesOnFailure'] = 0; // we handle it manualy
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
  public async loadMarkets() {
    await this.exchange.loadMarkets();
  }
  public async fetchTicker() {
    return this.retry<Ticker>(() => this.fetchTickerOnce());
  }
  public async fetchOHLCV(from?: EpochTimeStamp, timeframe?: string, limits?: number) {
    return this.retry<Candle[]>(() => this.fetchOHLCVOnce(from, timeframe, limits));
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
      if (err instanceof Error) error('exchange', `${this.exchangeName} call failed due to ${err.message}`);
      if (!isRetryableError || currRetry > BROKER_MAX_RETRIES_ON_FAILURE) throw err;
      await this.exchange.sleep(getRetryDelay(currRetry));
      warning('exchange', `Retrying to fetch (attempt ${currRetry})`);
      return this.retry(fn, currRetry + 1);
    }
  }

  // Protected functions
  protected async calculatePrice(side: Action) {
    const minimalPrice = this.exchange.market(this.symbol).limits.price?.min;
    const maximalPrice = this.exchange.market(this.symbol).limits.price?.max;
    if (isNil(minimalPrice) || isNil(maximalPrice)) throw new UndefinedLimitsError('price', minimalPrice, maximalPrice);

    const ticker = await this.fetchTicker();
    const price = side === 'buy' ? ticker.bid + minimalPrice : ticker.ask - minimalPrice;
    if (price > maximalPrice || price < minimalPrice)
      throw new OrderOutOfRangeError('exchange', 'price', price, minimalPrice, maximalPrice);
    return price;
  }

  protected calculateAmount(amount: number) {
    const minimalAmount = this.exchange.market(this.symbol).limits.amount?.min;
    const maximalAmount = this.exchange.market(this.symbol).limits.amount?.max;

    if (isNil(minimalAmount) || isNil(maximalAmount))
      throw new UndefinedLimitsError('amount', minimalAmount, maximalAmount);
    if (amount < minimalAmount) throw new OrderOutOfRangeError('exchange', 'amount', amount, minimalAmount);

    if (amount > maximalAmount) return maximalAmount;
    return amount;
  }

  protected checkCost(amount: number, price: number) {
    const minimalCost = this.exchange.market(this.symbol).limits.cost?.min;
    const maximalCost = this.exchange.market(this.symbol).limits.cost?.max;

    if (isNil(minimalCost) || isNil(maximalCost)) throw new UndefinedLimitsError('cost', minimalCost, maximalCost);

    const cost = amount * price;
    if (cost > maximalCost || cost < minimalCost)
      throw new OrderOutOfRangeError('exchange', 'cost', cost, minimalCost, maximalCost);
  }

  protected abstract cancelLimitOrderOnce(id: string): Promise<Order>;
  protected abstract createLimitOrderOnce(side: Action, amount: number): Promise<Order>;
  protected abstract fetchMyTradesOnce(from?: EpochTimeStamp): Promise<Trade[]>;
  protected abstract fetchOHLCVOnce(from?: EpochTimeStamp, timeframe?: string, limits?: number): Promise<Candle[]>;
  protected abstract fetchOrderOnce(id: string): Promise<Order>;
  protected abstract fetchPortfolioOnce(): Promise<Portfolio>;
  protected abstract fetchTickerOnce(): Promise<Ticker>;
  protected abstract fetchTradesOnce(): Promise<Trade[]>;
  public abstract onNewCandle(onNewCandle: (candle: Candle) => void): () => void;
}
