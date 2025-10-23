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
import { isNil } from 'lodash-es';
import { BROKER_MAX_RETRIES_ON_FAILURE, INTERVAL_BETWEEN_CALLS_IN_MS } from './exchange.const';
import { UndefinedLimitsError } from './exchange.error';

export interface MarketLimitRange {
  min?: number;
  max?: number;
}

export interface MarketLimits {
  price?: MarketLimitRange;
  amount?: MarketLimitRange;
  cost?: MarketLimitRange;
}

export abstract class Exchange {
  protected readonly exchangeName: string;
  protected readonly asset: string;
  protected readonly currency: string;
  protected readonly symbol: string;
  protected readonly interval: number;
  protected readonly sandbox: boolean;
  protected readonly apiKey?: string;
  protected readonly apiSecret?: string;
  protected readonly verbose: boolean;

  constructor({ name, interval, key, secret, sandbox, verbose }: ExchangeConfig) {
    const { asset, currency } = config.getWatch();
    this.exchangeName = name;
    this.asset = asset;
    this.currency = currency;
    this.symbol = `${asset}/${currency}`;
    this.interval = interval ?? INTERVAL_BETWEEN_CALLS_IN_MS;
    this.sandbox = sandbox ?? false;
    this.apiKey = key ?? undefined;
    this.apiSecret = secret ?? undefined;
    this.verbose = verbose ?? false;
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
    await this.loadMarketsImpl();
  }

  public async fetchTicker() {
    return this.retry<Ticker>(() => this.fetchTickerImpl());
  }

  public async getKlines(from?: EpochTimeStamp, timeframe?: string, limits?: number) {
    return this.retry<Candle[]>(() => this.getKlinesImpl(from, timeframe, limits));
  }

  public async fetchTrades() {
    return this.retry<Trade[]>(() => this.fetchTradesImpl());
  }

  public async fetchMyTrades(from?: EpochTimeStamp) {
    return this.retry<Trade[]>(() => this.fetchMyTradesImpl(from));
  }

  public async fetchPortfolio() {
    return this.retry<Portfolio>(() => this.fetchPortfolioImpl());
  }

  public async createLimitOrder(side: Action, amount: number) {
    return this.retry<Order>(() => this.createLimitOrderImpl(side, amount));
  }

  public async cancelLimitOrder(id: string) {
    return this.retry<Order>(() => this.cancelLimitOrderImpl(id));
  }

  public async fetchOrder(id: string) {
    return this.retry<Order>(() => this.fetchOrderImpl(id));
  }

  // Private functions
  private async retry<T>(fn: () => Promise<T>, currRetry = 1): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Error) error('exchange', `${this.exchangeName} call failed due to ${err.message}`);
      if (!this.isRetryableError(err) || currRetry > BROKER_MAX_RETRIES_ON_FAILURE) throw err;
      await this.sleep(getRetryDelay(currRetry));
      warning('exchange', `Retrying to fetch (attempt ${currRetry})`);
      return this.retry(fn, currRetry + 1);
    }
  }

  protected async sleep(delay: number) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Protected functions
  protected async calculatePrice(side: Action) {
    const limits = this.getMarketLimits();
    const priceLimits = limits?.price;
    const minimalPrice = priceLimits?.min;
    const maximalPrice = priceLimits?.max;

    if (isNil(minimalPrice)) throw new UndefinedLimitsError('price', minimalPrice, maximalPrice);

    const ticker = await this.fetchTicker();
    const price = side === 'buy' ? ticker.bid + minimalPrice : ticker.ask - minimalPrice;
    if (price < minimalPrice) throw new OrderOutOfRangeError('exchange', 'price', price, minimalPrice, maximalPrice);
    if (!isNil(maximalPrice) && price > maximalPrice)
      throw new OrderOutOfRangeError('exchange', 'price', price, minimalPrice, maximalPrice);
    return price;
  }

  protected calculateAmount(amount: number) {
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

  protected checkCost(amount: number, price: number) {
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

  protected abstract loadMarketsImpl(): Promise<void>;
  protected abstract fetchTickerImpl(): Promise<Ticker>;
  protected abstract getKlinesImpl(from?: EpochTimeStamp, timeframe?: string, limits?: number): Promise<Candle[]>;
  protected abstract fetchTradesImpl(): Promise<Trade[]>;
  protected abstract fetchMyTradesImpl(from?: EpochTimeStamp): Promise<Trade[]>;
  protected abstract fetchPortfolioImpl(): Promise<Portfolio>;
  protected abstract createLimitOrderImpl(side: Action, amount: number): Promise<Order>;
  protected abstract cancelLimitOrderImpl(id: string): Promise<Order>;
  protected abstract fetchOrderImpl(id: string): Promise<Order>;
  protected abstract getMarketLimits(): MarketLimits | undefined;
  protected abstract isRetryableError(error: unknown): boolean;

  public abstract onNewCandle(onNewCandle: (candle: Candle) => void): () => void;
}
