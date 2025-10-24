import { Candle } from '@models/candle.types';
import { Order } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { cloneDeep, isNil } from 'lodash-es';
import { DecentralizedExchange, NetworkConfiguration } from '../dex';
import { MarketLimits } from '../../exchange';
import {
  DummyDecentralizedExchangeConfig,
  DummyInternalOrder,
  DummyOrderSide,
} from './dummy-decentralized-exchange.types';
import { DUMMY_DEFAULT_LIMITS, DUMMY_DEFAULT_PORTFOLIO, DUMMY_DEFAULT_TICKER } from './dummy.const';

export class DummyDecentralizedExchange extends DecentralizedExchange<DummyDecentralizedExchangeConfig> {
  private readonly config: DummyDecentralizedExchangeConfig;
  private readonly orders = new Map<string, DummyInternalOrder>();
  private readonly trades: Trade[] = [];
  private readonly candlesByTimeframe = new Map<string, Candle[]>();
  private readonly pendingCandlesByTimeframe = new Map<string, Candle[]>();
  private readonly candleListeners = new Set<(candle: Candle) => void>();

  private marketsLoaded = false;
  private marketLimits: MarketLimits = cloneDeep(DUMMY_DEFAULT_LIMITS);
  private portfolio: Portfolio = cloneDeep(DUMMY_DEFAULT_PORTFOLIO);
  private ticker: Ticker = { ...DUMMY_DEFAULT_TICKER };
  private candleTimer?: NodeJS.Timeout;
  private orderSequence = 0;
  private tradeSequence = 0;
  private lastEmittedTradeIndex = 0;
  private readonly defaultTimeframe: string;

  constructor(config: DummyDecentralizedExchangeConfig) {
    super(config);
    this.config = config;
    this.defaultTimeframe = config.candleTimeframe ?? '1m';

    if (config.portfolio) this.portfolio = cloneDeep(config.portfolio);
    if (config.initialTicker) this.ticker = { ...config.initialTicker };
    if (config.limits) this.marketLimits = cloneDeep(config.limits);
  }

  public async loadMarkets(): Promise<void> {
    if (this.marketsLoaded) return;
    this.marketLimits = cloneDeep(this.config.limits ?? DUMMY_DEFAULT_LIMITS);
    this.portfolio = cloneDeep(this.config.portfolio ?? DUMMY_DEFAULT_PORTFOLIO);
    this.ticker = { ...(this.config.initialTicker ?? DUMMY_DEFAULT_TICKER) };
    this.marketsLoaded = true;
  }

  public async fetchTicker(): Promise<Ticker> {
    await this.ensureMarketsLoaded();
    return { ...this.ticker };
  }

  public async getKlines(from?: EpochTimeStamp, timeframe = this.defaultTimeframe, limits?: number): Promise<Candle[]> {
    await this.ensureMarketsLoaded();
    const candles = cloneDeep(this.candlesByTimeframe.get(timeframe) ?? []);
    const filtered = isNil(from) ? candles : candles.filter(candle => candle.start >= from);
    if (!isNil(limits)) {
      return filtered.slice(-limits);
    }
    return filtered;
  }

  public async fetchTrades(): Promise<Trade[]> {
    await this.ensureMarketsLoaded();
    return this.trades.map(trade => ({ ...trade, fee: { ...trade.fee } }));
  }

  public async fetchMyTrades(from?: EpochTimeStamp): Promise<Trade[]> {
    await this.ensureMarketsLoaded();
    const filtered = isNil(from) ? this.trades : this.trades.filter(trade => trade.timestamp >= from);
    return filtered.map(trade => ({ ...trade, fee: { ...trade.fee } }));
  }

  public async fetchPortfolio(): Promise<Portfolio> {
    await this.ensureMarketsLoaded();
    return { ...this.portfolio };
  }

  public async createLimitOrder(side: DummyOrderSide, amount: number): Promise<Order> {
    await this.ensureMarketsLoaded();
    const price = await this.calculatePrice(side);
    const normalizedAmount = this.calculateAmount(amount);
    this.checkCost(normalizedAmount, price);

    this.reserveBalance(side, normalizedAmount, price);

    const id = `order-${++this.orderSequence}`;
    const timestamp = Date.now();
    const order: DummyInternalOrder = {
      id,
      status: 'open',
      price,
      filled: 0,
      remaining: normalizedAmount,
      amount: normalizedAmount,
      timestamp,
      side,
    };
    this.orders.set(id, order);
    return this.cloneOrder(order);
  }

  public async cancelLimitOrder(id: string): Promise<Order> {
    await this.ensureMarketsLoaded();
    const order = this.orders.get(id);
    if (!order) throw new Error(`Unknown order: ${id}`);

    if (order.status === 'open') {
      this.releaseBalance(order);
      order.status = 'canceled';
      order.timestamp = Date.now();
      order.remaining = 0;
    }

    return this.cloneOrder(order);
  }

  public async fetchOrder(id: string): Promise<Order> {
    await this.ensureMarketsLoaded();
    const order = this.orders.get(id);
    if (!order) throw new Error(`Unknown order: ${id}`);
    return this.cloneOrder(order);
  }

  public addCandle(candle: Candle, timeframe = this.defaultTimeframe): void {
    void this.ensureMarketsLoaded();
    this.storeCandle(candle, timeframe);
    this.enqueueCandle(candle, timeframe);
    this.ticker = { bid: candle.close, ask: candle.close };
    this.settleOrdersWithCandle(candle);
  }

  public onNewCandle(onNewCandle: (candle: Candle) => void): () => void {
    this.candleListeners.add(onNewCandle);
    if (!this.candleTimer) {
      this.candleTimer = setInterval(() => this.emitPendingCandles(), this.interval);
    }

    return () => {
      this.candleListeners.delete(onNewCandle);
      if (!this.candleListeners.size && this.candleTimer) {
        clearInterval(this.candleTimer);
        this.candleTimer = undefined;
      }
    };
  }

  protected getMarketLimits(): MarketLimits | undefined {
    return this.marketLimits;
  }

  protected resolveNetworkConfiguration(config: DummyDecentralizedExchangeConfig): NetworkConfiguration | undefined {
    return config.networkConfiguration;
  }

  private async ensureMarketsLoaded() {
    if (!this.marketsLoaded) await this.loadMarkets();
  }

  private cloneOrder(order: DummyInternalOrder): Order {
    const { id, status, filled, remaining, price, timestamp } = order;
    return {
      id,
      status,
      filled,
      remaining,
      price,
      timestamp,
    };
  }

  private reserveBalance(side: DummyOrderSide, amount: number, price: number) {
    if (side === 'buy') {
      const cost = amount * price;
      if (this.portfolio.currency < cost) throw new Error('Insufficient currency balance');
      this.portfolio.currency -= cost;
    } else {
      if (this.portfolio.asset < amount) throw new Error('Insufficient asset balance');
      this.portfolio.asset -= amount;
    }
  }

  private releaseBalance(order: DummyInternalOrder) {
    const filled = order.filled ?? 0;
    const remaining = order.amount - filled;
    if (remaining <= 0) return;

    if (order.side === 'buy') {
      this.portfolio.currency += remaining * (order.price ?? 0);
    } else {
      this.portfolio.asset += remaining;
    }
  }

  private settleOrdersWithCandle(candle: Candle) {
    this.orders.forEach(order => {
      if (order.status !== 'open') return;
      const price = order.price ?? 0;
      const shouldFill = order.side === 'buy' ? candle.low <= price : candle.high >= price;
      if (!shouldFill) return;

      order.status = 'closed';
      order.filled = order.amount;
      order.remaining = 0;
      order.timestamp = candle.start;

      if (order.side === 'buy') {
        this.portfolio.asset += order.amount;
      } else {
        this.portfolio.currency += order.amount * price;
      }

      const trade: Trade = {
        id: `trade-${++this.tradeSequence}`,
        amount: order.amount,
        timestamp: candle.start,
        price,
        fee: { rate: 0 },
      };
      this.trades.push(trade);
    });
  }

  private storeCandle(candle: Candle, timeframe: string) {
    const candles = this.candlesByTimeframe.get(timeframe) ?? [];
    const index = candles.findIndex(existing => existing.start === candle.start);
    if (index >= 0) {
      candles.splice(index, 1, candle);
    } else {
      candles.push(candle);
      candles.sort((a, b) => a.start - b.start);
    }
    this.candlesByTimeframe.set(timeframe, candles);
  }

  private enqueueCandle(candle: Candle, timeframe: string) {
    const queue = this.pendingCandlesByTimeframe.get(timeframe) ?? [];
    queue.push(candle);
    this.pendingCandlesByTimeframe.set(timeframe, queue);
  }

  private emitPendingCandles() {
    const existingQueue = this.pendingCandlesByTimeframe.get(this.defaultTimeframe);
    if (!existingQueue?.length) {
      const derived = this.deriveCandleFromTrades();
      if (derived) {
        this.storeCandle(derived, this.defaultTimeframe);
        const derivedQueue = this.pendingCandlesByTimeframe.get(this.defaultTimeframe) ?? [];
        derivedQueue.push(derived);
        this.pendingCandlesByTimeframe.set(this.defaultTimeframe, derivedQueue);
        this.ticker = { bid: derived.close, ask: derived.close };
      }
    }

    const queue = this.pendingCandlesByTimeframe.get(this.defaultTimeframe);
    if (!queue?.length) return;

    while (queue.length) {
      const candle = queue.shift()!;
      this.candleListeners.forEach(listener => listener(candle));
    }

    this.lastEmittedTradeIndex = this.trades.length;
  }

  private deriveCandleFromTrades(): Candle | undefined {
    if (this.trades.length <= this.lastEmittedTradeIndex) return;
    const newTrades = this.trades.slice(this.lastEmittedTradeIndex);
    this.lastEmittedTradeIndex = this.trades.length;
    const open = newTrades[0];
    const close = newTrades[newTrades.length - 1];
    const high = Math.max(...newTrades.map(trade => trade.price));
    const low = Math.min(...newTrades.map(trade => trade.price));
    const volume = newTrades.reduce((acc, trade) => acc + trade.amount, 0);

    return {
      start: open.timestamp,
      open: open.price,
      high,
      low,
      close: close.price,
      volume,
    };
  }
}

export type { DummyDecentralizedExchangeConfig } from './dummy-decentralized-exchange.types';
