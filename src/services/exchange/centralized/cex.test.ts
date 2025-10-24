import { OrderOutOfRangeError } from '@errors/orderOutOfRange.error';
import { Action } from '@models/action.types';
import { Candle } from '@models/candle.types';
import { ExchangeConfig } from '@models/configuration.types';
import { Order } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { describe, expect, it, vi } from 'vitest';
import { MarketLimits } from '../exchange';
import { CentralizedExchange } from './cex';

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: () => ({ asset: 'BTC', currency: 'USDT' }),
  },
}));

class RetryableError extends Error {}

class TestCentralizedExchange extends CentralizedExchange {
  private readonly limits?: MarketLimits;
  private readonly tickerQueue: Array<Ticker | Error> = [];
  private readonly createOrderBehaviors: Array<'error' | 'success'> = [];
  public fetchTickerImplCalls = 0;
  public createLimitOrderImplCalls = 0;

  constructor(config: ExchangeConfig, limits?: MarketLimits) {
    super(config);
    this.limits = limits;
  }

  public enqueueTicker(response: Ticker | Error) {
    this.tickerQueue.push(response);
  }

  public enqueueCreateOrderBehavior(behavior: 'error' | 'success') {
    this.createOrderBehaviors.push(behavior);
  }

  protected async loadMarketsImpl(): Promise<void> {
    // no-op for tests
  }

  protected async fetchTickerImpl(): Promise<Ticker> {
    this.fetchTickerImplCalls += 1;
    if (!this.tickerQueue.length) {
      throw new Error('No ticker response configured');
    }
    const next = this.tickerQueue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }

  protected async getKlinesImpl(): Promise<Candle[]> {
    return [];
  }

  protected async fetchTradesImpl(): Promise<Trade[]> {
    return [];
  }

  protected async fetchMyTradesImpl(): Promise<Trade[]> {
    return [];
  }

  protected async fetchPortfolioImpl(): Promise<Portfolio> {
    return { asset: 0, currency: 0 };
  }

  protected async createLimitOrderImpl(side: Action, amount: number): Promise<Order> {
    this.createLimitOrderImplCalls += 1;
    const behavior = this.createOrderBehaviors.shift();
    if (behavior === 'error') throw new RetryableError('temporary failure');
    const price = await this.calculatePrice(side);
    const normalizedAmount = this.calculateAmount(amount);
    this.checkCost(normalizedAmount, price);
    return {
      id: `order-${this.createLimitOrderImplCalls}`,
      status: 'open',
      price,
      remaining: normalizedAmount,
      timestamp: 0,
    };
  }

  protected async cancelLimitOrderImpl(): Promise<Order> {
    return { id: 'cancel', status: 'canceled', timestamp: 0 };
  }

  protected async fetchOrderImpl(): Promise<Order> {
    return { id: '1', status: 'open', timestamp: 0 };
  }

  protected getMarketLimits(): MarketLimits | undefined {
    return this.limits;
  }

  protected isRetryableError(error: unknown): boolean {
    return error instanceof RetryableError;
  }

  protected async sleep(): Promise<void> {
    // avoid real timers in tests
  }

  public calculatePricePublic(side: Action) {
    return this.calculatePrice(side);
  }

  public calculateAmountPublic(amount: number) {
    return this.calculateAmount(amount);
  }

  public checkCostPublic(amount: number, price: number) {
    return this.checkCost(amount, price);
  }

  public onNewCandle(): () => void {
    return () => {};
  }
}

describe('CentralizedExchange', () => {
  const config = { name: 'binance', sandbox: false, verbose: false } as ExchangeConfig;
  const baseLimits: MarketLimits = {
    price: { min: 1, max: 1000 },
    amount: { min: 0.1, max: 5 },
    cost: { min: 10, max: 500 },
  };

  it('retries fetchTicker when retryable errors occur', async () => {
    const exchange = new TestCentralizedExchange(config, baseLimits);
    exchange.enqueueTicker(new RetryableError('boom'));
    exchange.enqueueTicker({ bid: 100, ask: 101 });

    await expect(exchange.fetchTicker()).resolves.toEqual({ bid: 100, ask: 101 });
    expect(exchange.fetchTickerImplCalls).toBe(2);
  });

  it('calculates buy and sell prices within configured limits', async () => {
    const exchange = new TestCentralizedExchange(config, baseLimits);
    exchange.enqueueTicker({ bid: 100, ask: 110 });
    await expect(exchange.calculatePricePublic('buy')).resolves.toBe(101);

    exchange.enqueueTicker({ bid: 100, ask: 110 });
    await expect(exchange.calculatePricePublic('sell')).resolves.toBe(109);
  });

  it('enforces amount limits when calculating order quantity', () => {
    const exchange = new TestCentralizedExchange(config, baseLimits);
    expect(() => exchange.calculateAmountPublic(0.01)).toThrow(OrderOutOfRangeError);
    expect(exchange.calculateAmountPublic(10)).toBe(5);
  });

  it('validates order cost before submission', () => {
    const exchange = new TestCentralizedExchange(config, baseLimits);
    expect(() => exchange.checkCostPublic(0.2, 40)).toThrow(OrderOutOfRangeError);
    expect(() => exchange.checkCostPublic(0.5, 30)).not.toThrow();
  });

  it('retries limit order creation and returns validated order details', async () => {
    const exchange = new TestCentralizedExchange(config, baseLimits);
    exchange.enqueueCreateOrderBehavior('error');
    exchange.enqueueCreateOrderBehavior('success');
    exchange.enqueueTicker({ bid: 100, ask: 105 });

    const order = await exchange.createLimitOrder('buy', 0.2);

    expect(exchange.createLimitOrderImplCalls).toBe(2);
    expect(order.price).toBe(101);
    expect(order.remaining).toBe(0.2);
  });

  it('rejects limit orders that violate cost limits', async () => {
    const exchange = new TestCentralizedExchange(config, baseLimits);
    exchange.enqueueTicker({ bid: 10, ask: 12 });

    await expect(exchange.createLimitOrder('buy', 0.2)).rejects.toThrow(OrderOutOfRangeError);
  });
});
