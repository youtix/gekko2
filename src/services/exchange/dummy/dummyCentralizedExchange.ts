import { GekkoError } from '@errors/gekko.error';
import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { config } from '@services/configuration/configuration';
import { DUMMY_DEFAULT_BUFFER_SIZE, LIMITS } from '@services/exchange/exchange.const';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { Exchange, FetchOHLCVParams, MarketData } from '@services/exchange/exchange.types';
import { RingBuffer } from '@utils/collection/ringBuffer';
import { toTimestamp } from '@utils/date/date.utils';
import { addMinutes } from 'date-fns';
import { bindAll, isNil } from 'lodash-es';
import { checkOrderAmount, checkOrderCost, checkOrderPrice } from '../exchange.utils';
import { DummyCentralizedExchangeConfig, DummyInternalOrder } from './dummyCentralizedExchange.types';

export class DummyCentralizedExchange implements Exchange {
  private readonly orders: RingBuffer<DummyInternalOrder>;
  private readonly candles: RingBuffer<Candle>;
  private readonly marketData: MarketData;
  private portfolio: Portfolio;
  private ticker: Ticker;
  private currentTimestamp: EpochTimeStamp;
  private orderSequence = 0;

  constructor(exchangeConfig: DummyCentralizedExchangeConfig) {
    this.marketData = exchangeConfig.marketData;
    this.portfolio = { ...exchangeConfig.simulationBalance };
    this.ticker = { ...exchangeConfig.initialTicker };
    this.candles = new RingBuffer(DUMMY_DEFAULT_BUFFER_SIZE);
    this.orders = new RingBuffer(DUMMY_DEFAULT_BUFFER_SIZE);
    const start = config.getWatch().daterange?.start;
    if (!start) throw new GekkoError('exchange', 'Inconsistent state: In backtest mode dateranges are mandatory');
    this.currentTimestamp = toTimestamp(start);

    bindAll(this, [this.mapOrderToTrade.name]);
  }

  public getExchangeName(): string {
    return 'dummy-cex';
  }

  /** Because dummy exchange is not a plugin, I need to call this function manualy in the plugins stream */
  public processOneMinuteCandle(candle: Candle): void {
    // console.table(this.orders.toArray().slice(-10));
    // I need the close time of the candle
    this.currentTimestamp = addMinutes(candle.start, 1).getTime();
    this.candles.push(candle);
    this.ticker = { bid: candle.close, ask: candle.close };
    this.settleOrdersWithCandle(candle);
  }

  public onNewCandle(_onNewCandle: (candle: Candle) => void): () => void {
    // Nothing to do because it is impossible to use this exchange in realtime
    return () => {};
  }

  public async loadMarkets(): Promise<void> {
    // Nothing to do, already done in constructor
  }

  public async fetchTicker(): Promise<Ticker> {
    return { ...this.ticker };
  }

  public async fetchOHLCV({
    from,
    limit = LIMITS[this.getExchangeName()].candles,
  }: FetchOHLCVParams): Promise<Candle[]> {
    const arr = this.candles.toArray();
    const filtered = isNil(from) ? arr : arr.filter(candle => candle.start >= from);
    if (!isNil(limit)) return filtered.slice(-limit);
    return filtered;
  }

  public async fetchMyTrades(from?: EpochTimeStamp): Promise<Trade[]> {
    const arr = this.orders.toArray();
    const filtered = isNil(from) ? arr : arr.filter(order => order.timestamp >= from);
    return filtered.map(this.mapOrderToTrade);
  }

  public async fetchBalance(): Promise<Portfolio> {
    return { ...this.portfolio };
  }

  public async createLimitOrder(side: OrderSide, amount: number, price: number): Promise<OrderState> {
    const checkedPrice = checkOrderPrice(price, this.marketData);
    const normalizedAmount = checkOrderAmount(amount, this.marketData);
    checkOrderCost(normalizedAmount, checkedPrice, this.marketData);

    this.reserveBalance(side, normalizedAmount, checkedPrice);

    const id = `order-${++this.orderSequence}`;
    const order: DummyInternalOrder = {
      id,
      status: 'open',
      price: checkedPrice,
      filled: 0,
      remaining: normalizedAmount,
      amount: normalizedAmount,
      timestamp: this.currentTimestamp,
      side,
      type: 'LIMIT',
    };
    this.orders.push(order);
    return this.cloneOrder(order);
  }

  public async createMarketOrder(side: OrderSide, amount: number): Promise<OrderState> {
    const normalizedAmount = checkOrderAmount(amount, this.marketData);
    const price = side === 'BUY' ? this.ticker.ask : this.ticker.bid;
    checkOrderCost(normalizedAmount, price, this.marketData);

    const id = `order-${++this.orderSequence}`;
    const cost = normalizedAmount * price;
    const totalCost = cost * (1 + (this.marketData.fee?.taker ?? 0));

    if (side === 'BUY') {
      if (this.portfolio.currency < totalCost)
        throw new InvalidOrder(
          `Insufficient currency balance (portfolio: ${this.portfolio.currency}, order cost: ${totalCost})`,
        );
      this.portfolio.currency -= totalCost;
      this.portfolio.asset += normalizedAmount;
    } else {
      if (this.portfolio.asset < normalizedAmount)
        throw new InvalidOrder(
          `Insufficient asset balance (portfolio: ${this.portfolio.asset}, amount: ${normalizedAmount})`,
        );
      this.portfolio.asset -= normalizedAmount;
      this.portfolio.currency += cost * (1 - (this.marketData.fee?.taker ?? 0));
    }

    const order: DummyInternalOrder = {
      id,
      status: 'closed',
      price,
      filled: normalizedAmount,
      remaining: 0,
      amount: normalizedAmount,
      timestamp: this.currentTimestamp,
      side,
      type: 'MARKET',
    };

    this.orders.push(order);

    return this.cloneOrder(order);
  }

  public async cancelOrder(id: string): Promise<OrderState> {
    const order = this.orders.find(c => c.id === id);
    if (!order) throw new OrderNotFound(`Unknown order: ${id}`);

    if (order.status === 'open') {
      this.releaseBalance(order);
      order.status = 'canceled';
      order.timestamp = this.currentTimestamp;
    }

    return this.cloneOrder(order);
  }

  public async fetchOrder(id: string): Promise<OrderState> {
    const order = this.orders.find(c => c.id === id);
    if (!order) throw new OrderNotFound(`Unknown order: ${id}`);
    return this.cloneOrder(order);
  }

  public getMarketData(): MarketData {
    return this.marketData;
  }

  private reserveBalance(side: OrderSide, amount: number, price: number) {
    if (side === 'BUY') {
      const cost = amount * price;
      const totalCost = cost * (1 + (this.marketData.fee?.maker ?? 0));
      if (this.portfolio.currency < totalCost)
        throw new InvalidOrder(
          `Insufficient currency balance (portfolio: ${this.portfolio.currency}, order cost: ${totalCost})`,
        );
      this.portfolio.currency -= totalCost;
    } else {
      if (this.portfolio.asset < amount)
        throw new InvalidOrder(
          `Insufficient asset balance (portfolio: ${this.portfolio.asset}, order cost: ${amount})`,
        );
      this.portfolio.asset -= amount;
    }
  }

  private releaseBalance(order: DummyInternalOrder) {
    const filled = order.filled ?? 0;
    const remaining = order.amount - filled;
    if (remaining <= 0) return;

    if (order.side === 'BUY') {
      this.portfolio.currency += remaining * (order.price ?? 0) * (1 + (this.marketData.fee?.maker ?? 0));
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
      order.timestamp = this.currentTimestamp;

      if (order.side === 'BUY') {
        this.portfolio.asset += order.amount;
      } else {
        this.portfolio.currency += order.amount * price * (1 - (this.marketData.fee?.maker ?? 0));
      }
    });
  }

  private cloneOrder(order: DummyInternalOrder): OrderState {
    const { id, status, filled, remaining, price, timestamp } = order;
    return { id, status, filled, remaining, price, timestamp };
  }

  private mapOrderToTrade(order: DummyInternalOrder): Trade {
    const feeRate = order.type === 'MARKET' ? (this.marketData.fee?.taker ?? 0) : (this.marketData.fee?.maker ?? 0);

    return {
      id: order.id,
      amount: order.filled ?? 0,
      price: order.price ?? 0,
      timestamp: order.timestamp,
      fee: { rate: feeRate * 100 },
    };
  }
}
