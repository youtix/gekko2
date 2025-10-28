import { Candle } from '@models/candle.types';
import { OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { DUMMY_DEFAULT_BUFFER_SIZE } from '@services/exchange/exchange.const';
import { MarketLimits } from '@services/exchange/exchange.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import { isNil } from 'lodash-es';
import { CentralizedExchange } from '../cex';
import { DummyCentralizedExchangeConfig, DummyInternalOrder, DummyOrderSide } from './dummyCentralizedExchange.types';

export class DummyCentralizedExchange extends CentralizedExchange {
  private readonly orders: RingBuffer<DummyInternalOrder>;
  private readonly trades: RingBuffer<Trade>;
  private readonly candles: RingBuffer<Candle>;
  /** Maker fee in % */
  private readonly makerFee: number;
  /** Taker fee in % */
  private readonly takerFee: number;
  private readonly marketLimits: MarketLimits;
  private portfolio: Portfolio;
  private ticker: Ticker;

  private orderSequence = 0;
  private tradeSequence = 0;

  constructor(config: DummyCentralizedExchangeConfig) {
    super(config);
    this.makerFee = config.feeMaker ?? 0;
    this.takerFee = config.feeTaker ?? 0;
    this.marketLimits = config.limits;
    this.portfolio = { ...config.simulationBalance };
    this.ticker = { ...config.initialTicker };
    this.candles = new RingBuffer(DUMMY_DEFAULT_BUFFER_SIZE);
    this.trades = new RingBuffer(DUMMY_DEFAULT_BUFFER_SIZE);
    this.orders = new RingBuffer(DUMMY_DEFAULT_BUFFER_SIZE);
  }

  public addCandle(candle: Candle): void {
    this.candles.push(candle);
    this.ticker = { bid: candle.close, ask: candle.close };
    this.settleOrdersWithCandle(candle);
  }

  public onNewCandle(_onNewCandle: (candle: Candle) => void): () => void {
    // Nothing to do because it is impossible to use this exchange in realtime
    return () => {};
  }

  protected async loadMarketsImpl(): Promise<void> {
    // Nothing to do, already done in constructor
  }

  protected async fetchTickerImpl(): Promise<Ticker> {
    return { ...this.ticker };
  }

  protected async getKlinesImpl(
    from?: EpochTimeStamp,
    _timeframe?: string, // Not used in dummy
    limits?: number,
  ): Promise<Candle[]> {
    const arr = this.candles.toArray();
    const filtered = isNil(from) ? arr : arr.filter(candle => candle.start >= from);
    if (!isNil(limits)) return filtered.slice(-limits);
    return filtered;
  }

  protected async fetchTradesImpl(): Promise<Trade[]> {
    return this.trades.toArray().map(trade => ({ ...trade, fee: { ...trade.fee } }));
  }

  protected async fetchMyTradesImpl(from?: EpochTimeStamp): Promise<Trade[]> {
    const arr = this.trades.toArray();
    const filtered = isNil(from) ? arr : arr.filter(trade => trade.timestamp >= from);
    return filtered.map(trade => ({ ...trade, fee: { ...trade.fee } }));
  }

  protected async fetchPortfolioImpl(): Promise<Portfolio> {
    return { ...this.portfolio };
  }

  protected async createLimitOrderImpl(side: DummyOrderSide, amount: number): Promise<OrderState> {
    const price = await this.checkOrderPrice(side);
    const normalizedAmount = this.checkOrderAmount(amount);
    this.checkOrderCost(normalizedAmount, price);

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
    this.orders.push(order);
    return this.cloneOrder(order);
  }

  protected async createMarketOrderImpl(side: DummyOrderSide, amount: number): Promise<OrderState> {
    const normalizedAmount = this.checkOrderAmount(amount);
    const price = side === 'BUY' ? this.ticker.ask : this.ticker.bid;
    this.checkOrderCost(normalizedAmount, price);

    const id = `order-${++this.orderSequence}`;
    const timestamp = Date.now();
    const cost = normalizedAmount * price;

    if (side === 'BUY') {
      if (this.portfolio.currency < cost) throw new Error('Insufficient currency balance');
      this.portfolio.currency -= cost * (1 + this.takerFee);
      this.portfolio.asset += normalizedAmount;
    } else {
      if (this.portfolio.asset < normalizedAmount) throw new Error('Insufficient asset balance');
      this.portfolio.asset -= normalizedAmount;
      this.portfolio.currency += cost * (1 - this.takerFee);
    }

    const order: DummyInternalOrder = {
      id,
      status: 'closed',
      price,
      filled: normalizedAmount,
      remaining: 0,
      amount: normalizedAmount,
      timestamp,
      side,
    };

    this.orders.push(order);

    const trade: Trade = {
      id: `trade-${++this.tradeSequence}`,
      amount: normalizedAmount,
      timestamp,
      price,
      fee: { rate: this.takerFee },
    };
    this.trades.push(trade);

    return this.cloneOrder(order);
  }

  protected async cancelOrderImpl(id: string): Promise<OrderState> {
    const order = this.orders.find(c => c.id === id);
    if (!order) throw new Error(`Unknown order: ${id}`);

    if (order.status === 'open') {
      this.releaseBalance(order);
      order.status = 'canceled';
      order.timestamp = Date.now();
      order.remaining = 0;
    }

    return this.cloneOrder(order);
  }

  protected async fetchOrderImpl(id: string): Promise<OrderState> {
    const order = this.orders.find(c => c.id === id);
    if (!order) throw new Error(`Unknown order: ${id}`);
    return this.cloneOrder(order);
  }

  protected getMarketLimits(): MarketLimits | undefined {
    return this.marketLimits;
  }

  protected isRetryableError(): boolean {
    return false;
  }

  private cloneOrder(order: DummyInternalOrder): OrderState {
    const { id, status, filled, remaining, price, timestamp } = order;
    return { id, status, filled, remaining, price, timestamp };
  }

  private reserveBalance(side: DummyOrderSide, amount: number, price: number) {
    if (side === 'BUY') {
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

    if (order.side === 'BUY') {
      this.portfolio.currency += remaining * (order.price ?? 0);
    } else {
      this.portfolio.asset += remaining;
    }
  }

  private settleOrdersWithCandle(candle: Candle) {
    this.orders.forEach(order => {
      if (order.status !== 'open') return;
      const price = order.price ?? 0;
      const shouldFill = order.side === 'BUY' ? candle.low <= price : candle.high >= price;
      if (!shouldFill) return;

      order.status = 'closed';
      order.filled = order.amount;
      order.remaining = 0;
      order.timestamp = candle.start;

      if (order.side === 'BUY') {
        this.portfolio.asset += order.amount;
      } else {
        this.portfolio.currency += order.amount * price;
      }

      const trade: Trade = {
        id: `trade-${++this.tradeSequence}`,
        amount: order.amount,
        timestamp: candle.start,
        price,
        fee: { rate: this.makerFee },
      };
      this.trades.push(trade);
    });
  }
}
