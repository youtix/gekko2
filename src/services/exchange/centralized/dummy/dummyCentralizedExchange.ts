import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { DUMMY_DEFAULT_BUFFER_SIZE } from '@services/exchange/exchange.const';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { MarketLimits } from '@services/exchange/exchange.types';
import { RingBuffer } from '@utils/collection/ringBuffer';
import { bindAll, isNil } from 'lodash-es';
import { CentralizedExchange } from '../cex';
import { DummyCentralizedExchangeConfig, DummyInternalOrder } from './dummyCentralizedExchange.types';

export class DummyCentralizedExchange extends CentralizedExchange {
  private readonly orders: RingBuffer<DummyInternalOrder>;
  private readonly candles: RingBuffer<Candle>;
  /** Maker fee as decimal fraction */
  private readonly makerFee: number;
  /** Taker fee as decimal fraction */
  private readonly takerFee: number;
  private readonly marketLimits: MarketLimits;
  private portfolio: Portfolio;
  private ticker: Ticker;

  private orderSequence = 0;

  constructor(config: DummyCentralizedExchangeConfig) {
    super(config);
    this.makerFee = (config.feeMaker ?? 0) / 100;
    this.takerFee = (config.feeTaker ?? 0) / 100;
    this.marketLimits = config.limits;
    this.portfolio = { ...config.simulationBalance };
    this.ticker = { ...config.initialTicker };
    this.candles = new RingBuffer(DUMMY_DEFAULT_BUFFER_SIZE);
    this.orders = new RingBuffer(DUMMY_DEFAULT_BUFFER_SIZE);

    bindAll(this, [this.mapOrderToTrade.name]);
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
    return this.orders.toArray().map(this.mapOrderToTrade);
  }

  protected async fetchMyTradesImpl(from?: EpochTimeStamp): Promise<Trade[]> {
    const arr = this.orders.toArray();
    const filtered = isNil(from) ? arr : arr.filter(order => order.timestamp >= from);
    return filtered.map(this.mapOrderToTrade);
  }

  protected async fetchPortfolioImpl(): Promise<Portfolio> {
    return { ...this.portfolio };
  }

  protected async createLimitOrderImpl(side: OrderSide, amount: number, price: number): Promise<OrderState> {
    const checkedPrice = await this.checkOrderPrice(price);
    const normalizedAmount = this.checkOrderAmount(amount);
    this.checkOrderCost(normalizedAmount, checkedPrice);

    this.reserveBalance(side, normalizedAmount, checkedPrice);

    const id = `order-${++this.orderSequence}`;
    const timestamp = this.candles.last().start;
    const order: DummyInternalOrder = {
      id,
      status: 'open',
      price: checkedPrice,
      filled: 0,
      remaining: normalizedAmount,
      amount: normalizedAmount,
      timestamp,
      side,
      type: 'LIMIT',
    };
    this.orders.push(order);
    return this.cloneOrder(order);
  }

  protected async createMarketOrderImpl(side: OrderSide, amount: number): Promise<OrderState> {
    const normalizedAmount = this.checkOrderAmount(amount);
    const price = side === 'BUY' ? this.ticker.ask : this.ticker.bid;
    this.checkOrderCost(normalizedAmount, price);

    const id = `order-${++this.orderSequence}`;
    const timestamp = this.candles.last().start;
    const cost = normalizedAmount * price;
    const totalCost = cost * (1 + this.takerFee);

    if (side === 'BUY') {
      if (this.portfolio.currency < totalCost) throw new InvalidOrder('Insufficient currency balance');
      this.portfolio.currency -= totalCost;
      this.portfolio.asset += normalizedAmount;
    } else {
      if (this.portfolio.asset < normalizedAmount) throw new InvalidOrder('Insufficient asset balance');
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
      type: 'MARKET',
    };

    this.orders.push(order);

    return this.cloneOrder(order);
  }

  protected async cancelOrderImpl(id: string): Promise<OrderState> {
    const order = this.orders.find(c => c.id === id);
    if (!order) throw new OrderNotFound(`Unknown order: ${id}`);

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
    if (!order) throw new OrderNotFound(`Unknown order: ${id}`);
    return this.cloneOrder(order);
  }

  public getMarketLimits(): MarketLimits | undefined {
    return this.marketLimits;
  }

  protected isRetryableError(): boolean {
    return false;
  }

  private reserveBalance(side: OrderSide, amount: number, price: number) {
    if (side === 'BUY') {
      const cost = amount * price;
      const totalCost = cost * (1 + this.makerFee);
      if (this.portfolio.currency < totalCost) throw new InvalidOrder('Insufficient currency balance');
      this.portfolio.currency -= totalCost;
    } else {
      if (this.portfolio.asset < amount) throw new InvalidOrder('Insufficient asset balance');
      this.portfolio.asset -= amount;
    }
  }

  private releaseBalance(order: DummyInternalOrder) {
    const filled = order.filled ?? 0;
    const remaining = order.amount - filled;
    if (remaining <= 0) return;

    if (order.side === 'BUY') {
      this.portfolio.currency += remaining * (order.price ?? 0) * (1 + this.makerFee);
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
        this.portfolio.currency += order.amount * price * (1 - this.makerFee);
      }
    });
  }

  private cloneOrder(order: DummyInternalOrder): OrderState {
    const { id, status, filled, remaining, price, timestamp } = order;
    return { id, status, filled, remaining, price, timestamp };
  }

  private mapOrderToTrade(order: DummyInternalOrder): Trade {
    const feeRate = order.type === 'MARKET' ? this.takerFee : this.makerFee;

    return {
      id: order.id,
      amount: order.filled ?? 0,
      price: order.price ?? 0,
      timestamp: order.timestamp,
      fee: { rate: feeRate * 100 },
    };
  }
}
