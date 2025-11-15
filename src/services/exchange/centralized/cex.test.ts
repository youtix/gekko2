import { Candle } from '@models/candle.types';
import { OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { Nullable } from '@models/utility.types';
import { describe, expect, it, vi } from 'vitest';
import { MarketLimits } from '../exchange.types';
import { CentralizedExchange } from './cex';

vi.mock('@services/logger', () => ({ warning: vi.fn(), error: vi.fn() }));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({ asset: 'BTC', currency: 'USDT' }),
    getExchange: () => ({ name: 'binance', exchangeSynchInterval: 10, orderSynchInterval: 1 }),
  },
}));

class RetryableError extends Error {}

type MethodKey =
  | 'loadMarkets'
  | 'fetchTicker'
  | 'getKlines'
  | 'fetchMyTrades'
  | 'fetchPortfolio'
  | 'createLimitOrder'
  | 'createMarketOrder'
  | 'cancelOrder'
  | 'fetchOrder';

type CounterKey =
  | 'loadMarketsImplCalls'
  | 'fetchTickerImplCalls'
  | 'getKlinesImplCalls'
  | 'fetchMyTradesImplCalls'
  | 'fetchPortfolioImplCalls'
  | 'createLimitOrderImplCalls'
  | 'createMarketOrderImplCalls'
  | 'cancelOrderImplCalls'
  | 'fetchOrderImplCalls';

class TestCentralizedExchange extends CentralizedExchange {
  private readonly limits: Nullable<MarketLimits>;
  private readonly failureCounts: Partial<Record<MethodKey, number>> = {};
  private nextTicker: Ticker = { bid: 100, ask: 101 };

  public loadMarketsImplCalls = 0;
  public fetchTickerImplCalls = 0;
  public getKlinesImplCalls = 0;
  public fetchMyTradesImplCalls = 0;
  public fetchPortfolioImplCalls = 0;
  public createLimitOrderImplCalls = 0;
  public createMarketOrderImplCalls = 0;
  public cancelOrderImplCalls = 0;
  public fetchOrderImplCalls = 0;

  constructor(limits: Nullable<MarketLimits>) {
    super();
    this.limits = limits;
  }

  public failTimes(method: MethodKey, attempts: number) {
    this.failureCounts[method] = attempts;
  }

  public setTicker(ticker: Ticker) {
    this.nextTicker = ticker;
  }

  private maybeFail(method: MethodKey) {
    const remaining = this.failureCounts[method];
    if (remaining && remaining > 0) {
      this.failureCounts[method] = remaining - 1;
      throw new RetryableError(`retry ${method}`);
    }
  }

  protected async loadMarketsImpl(): Promise<void> {
    this.loadMarketsImplCalls += 1;
    this.maybeFail('loadMarkets');
  }

  protected async fetchTickerImpl(): Promise<Ticker> {
    this.fetchTickerImplCalls += 1;
    this.maybeFail('fetchTicker');
    return this.nextTicker;
  }

  protected async getKlinesImpl(): Promise<Candle[]> {
    this.getKlinesImplCalls += 1;
    this.maybeFail('getKlines');
    return [];
  }

  protected async fetchMyTradesImpl(): Promise<Trade[]> {
    this.fetchMyTradesImplCalls += 1;
    this.maybeFail('fetchMyTrades');
    return [];
  }

  protected async fetchPortfolioImpl(): Promise<Portfolio> {
    this.fetchPortfolioImplCalls += 1;
    this.maybeFail('fetchPortfolio');
    return { asset: 0, currency: 0 };
  }

  protected async createLimitOrderImpl(): Promise<OrderState> {
    this.createLimitOrderImplCalls += 1;
    this.maybeFail('createLimitOrder');
    return { id: `limit-${this.createLimitOrderImplCalls}`, status: 'open', timestamp: Date.now() };
  }

  protected async createMarketOrderImpl(): Promise<OrderState> {
    this.createMarketOrderImplCalls += 1;
    this.maybeFail('createMarketOrder');
    return { id: `market-${this.createMarketOrderImplCalls}`, status: 'closed', timestamp: Date.now() };
  }

  protected async cancelOrderImpl(): Promise<OrderState> {
    this.cancelOrderImplCalls += 1;
    this.maybeFail('cancelOrder');
    return { id: 'cancel', status: 'canceled', timestamp: Date.now() };
  }

  protected async fetchOrderImpl(): Promise<OrderState> {
    this.fetchOrderImplCalls += 1;
    this.maybeFail('fetchOrder');
    return { id: '1', status: 'open', timestamp: Date.now() };
  }

  public getMarketLimits(): Nullable<MarketLimits> {
    return this.limits;
  }

  protected isRetryableError(error: unknown): boolean {
    return error instanceof RetryableError;
  }

  protected async sleep(): Promise<void> {
    // avoid real timers in tests
  }

  public onNewCandle(): () => void {
    return () => {};
  }
}

describe('CentralizedExchange retry logic', () => {
  const baseLimits: MarketLimits = {
    price: { min: 1, max: 10_000 },
    amount: { min: 0.001, max: 100 },
    cost: { min: 10, max: 1_000_000 },
  };

  const scenarios: Array<{
    method: MethodKey;
    counter: CounterKey;
    call: (exchange: TestCentralizedExchange) => Promise<unknown>;
    expectsResult?: boolean;
  }> = [
    {
      method: 'loadMarkets',
      counter: 'loadMarketsImplCalls',
      call: exchange => exchange.loadMarkets(),
      expectsResult: false,
    },
    {
      method: 'fetchTicker',
      counter: 'fetchTickerImplCalls',
      call: exchange => exchange.fetchTicker(),
      expectsResult: true,
    },
    { method: 'getKlines', counter: 'getKlinesImplCalls', call: exchange => exchange.getKlines() },
    { method: 'fetchMyTrades', counter: 'fetchMyTradesImplCalls', call: exchange => exchange.fetchMyTrades() },
    { method: 'fetchPortfolio', counter: 'fetchPortfolioImplCalls', call: exchange => exchange.fetchPortfolio() },
    {
      method: 'createLimitOrder',
      counter: 'createLimitOrderImplCalls',
      call: exchange => exchange.createLimitOrder('BUY', 1, 100),
    },
    {
      method: 'createMarketOrder',
      counter: 'createMarketOrderImplCalls',
      call: exchange => exchange.createMarketOrder('SELL', 1),
    },
    { method: 'cancelOrder', counter: 'cancelOrderImplCalls', call: exchange => exchange.cancelOrder('id') },
    { method: 'fetchOrder', counter: 'fetchOrderImplCalls', call: exchange => exchange.fetchOrder('id') },
  ];

  it.each(scenarios)(
    'retries %s when a retryable error occurs',
    async ({ method, counter, call, expectsResult = true }) => {
      const exchange = new TestCentralizedExchange(baseLimits);
      exchange.failTimes(method, 1);
      exchange.setTicker({ bid: 100, ask: 101 });

      const result = await call(exchange);
      if (expectsResult) {
        expect(result).toBeDefined();
      }
      expect(exchange[counter]).toBe(2);
    },
  );
});
