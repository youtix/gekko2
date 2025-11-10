import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { error, warning } from '@services/logger';
import { getRetryDelay } from '@utils/fetch/fetch.utils';
import { Exchange } from '../exchange';
import { BROKER_MAX_RETRIES_ON_FAILURE } from '../exchange.const';
import { CentralizedExchangeConfig } from './cex.types';

export abstract class CentralizedExchange extends Exchange {
  protected readonly sandbox: boolean;
  protected readonly apiKey?: string;
  protected readonly apiSecret?: string;
  protected readonly verbose: boolean;

  constructor(config: CentralizedExchangeConfig) {
    const { key, secret, sandbox, verbose } = config;
    super({ name: config.name, interval: config.interval });
    this.sandbox = sandbox ?? false;
    this.apiKey = key ?? undefined;
    this.apiSecret = secret ?? undefined;
    this.verbose = verbose ?? false;
  }

  public async loadMarkets() {
    await this.retry(() => this.loadMarketsImpl());
  }

  public async fetchTicker() {
    return this.retry(() => this.fetchTickerImpl());
  }

  public async getKlines(from?: EpochTimeStamp, timeframe?: string, limits?: number) {
    return this.retry(() => this.getKlinesImpl(from, timeframe, limits));
  }

  public async fetchMyTrades(from?: EpochTimeStamp) {
    return this.retry(() => this.fetchMyTradesImpl(from));
  }

  public async fetchPortfolio() {
    return this.retry(() => this.fetchPortfolioImpl());
  }

  public async createLimitOrder(side: OrderSide, amount: number, price: number) {
    return this.retry(() => this.createLimitOrderImpl(side, amount, price));
  }

  public async createMarketOrder(side: OrderSide, amount: number) {
    return this.retry(() => this.createMarketOrderImpl(side, amount));
  }

  public async cancelOrder(id: string) {
    return this.retry(() => this.cancelOrderImpl(id));
  }

  public async fetchOrder(id: string) {
    return this.retry(() => this.fetchOrderImpl(id));
  }

  protected async sleep(delay: number) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  protected abstract loadMarketsImpl(): Promise<void>;
  protected abstract fetchTickerImpl(): Promise<Ticker>;
  protected abstract getKlinesImpl(from?: EpochTimeStamp, timeframe?: string, limits?: number): Promise<Candle[]>;
  protected abstract fetchMyTradesImpl(from?: EpochTimeStamp): Promise<Trade[]>;
  protected abstract fetchPortfolioImpl(): Promise<Portfolio>;
  protected abstract createLimitOrderImpl(side: OrderSide, amount: number, price: number): Promise<OrderState>;
  protected abstract createMarketOrderImpl(side: OrderSide, amount: number): Promise<OrderState>;
  protected abstract cancelOrderImpl(id: string): Promise<OrderState>;
  protected abstract fetchOrderImpl(id: string): Promise<OrderState>;
  protected abstract isRetryableError(error: unknown): boolean;

  private async retry<T>(fn: () => Promise<T>, currRetry = 1): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Error) error('exchange', `${this.getExchangeName()} call failed due to ${err.message}`);
      if (!this.isRetryableError(err) || currRetry > BROKER_MAX_RETRIES_ON_FAILURE) throw err;
      await this.sleep(getRetryDelay(currRetry));
      warning('exchange', `Retrying to fetch (attempt ${currRetry})`);
      return this.retry(fn, currRetry + 1);
    }
  }
}
