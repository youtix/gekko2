import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Ticker } from '@models/ticker.types';
import { Trade } from '@models/trade.types';
import { config } from '@services/configuration/configuration';
import { LIMITS } from '@services/exchange/exchange.const';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { Exchange, FetchOHLCVParams, MarketData, OrderSettledCallback } from '@services/exchange/exchange.types';
import { toTimestamp } from '@utils/date/date.utils';
import { clonePortfolio } from '@utils/portfolio/portfolio.utils';
import { addMinutes } from 'date-fns';
import { bindAll, isNil } from 'lodash-es';
import { AsyncMutex } from '../../../utils/async/asyncMutex';
import { checkOrderAmount, checkOrderCost, checkOrderPrice } from '../exchange.utils';
import { DummyCentralizedExchangeConfig, DummyInternalOrder } from './dummyCentralizedExchange.types';
import { findCandleIndexByTimestamp } from './dummyCentralizedExchange.utils';

export class DummyCentralizedExchange implements Exchange {
  private readonly mutex = new AsyncMutex();
  private readonly ordersMap: Map<string, DummyInternalOrder>;
  private readonly orderSettledCallbacks: Map<string, OrderSettledCallback>;
  private readonly buyOrders: DummyInternalOrder[]; // Sorted by price DESC
  private readonly sellOrders: DummyInternalOrder[]; // Sorted by price ASC
  private readonly candles: Candle[];
  private readonly marketData: MarketData;
  private readonly portfolio: Portfolio;
  private ticker: Ticker;
  private currentTimestamp: EpochTimeStamp;
  private orderSequence = 0;

  constructor(exchangeConfig: DummyCentralizedExchangeConfig) {
    const { marketData, simulationBalance, initialTicker } = exchangeConfig;
    const { pairs, daterange } = config.getWatch();
    const { symbol } = pairs[0]; // TODO: support multiple pairs
    const [asset, currency] = symbol.split('/');
    this.marketData = marketData;
    this.portfolio = new Map([
      [asset, { free: simulationBalance.asset, used: 0, total: simulationBalance.asset }],
      [currency, { free: simulationBalance.currency, used: 0, total: simulationBalance.currency }],
    ]);
    this.ticker = { ...initialTicker };
    this.candles = [];
    this.ordersMap = new Map();
    this.orderSettledCallbacks = new Map();
    this.buyOrders = [];
    this.sellOrders = [];
    this.currentTimestamp = daterange?.start ? toTimestamp(daterange.start) : Date.now();

    bindAll(this, [this.mapOrderToTrade.name]);
  }

  public getExchangeName(): string {
    return 'dummy-cex';
  }

  /** Because dummy exchange is not a plugin, I need to call this function manualy in the plugins stream */
  public async processOneMinuteCandle(candle: Candle): Promise<void> {
    return this.mutex.runExclusive(() => {
      // I need the close time of the candle
      this.currentTimestamp = addMinutes(candle.start, 1).getTime();
      this.candles.push(candle);
      this.ticker = { bid: candle.close, ask: candle.close };
      this.settleOrdersWithCandle(candle);
    });
  }

  public onNewCandle(_onNewCandle: (candle: Candle) => void): () => void {
    // Nothing to do because it is impossible to use this exchange in realtime
    return () => {};
  }

  public async loadMarkets(): Promise<void> {
    // Nothing to do, already done in constructor
  }

  public async fetchTicker(): Promise<Ticker> {
    return this.mutex.runExclusive(() => ({ ...this.ticker }));
  }

  public async fetchOHLCV({
    from,
    limit = LIMITS[this.getExchangeName()].candles,
  }: FetchOHLCVParams): Promise<Candle[]> {
    return this.mutex.runExclusive(() => {
      if (this.candles.length === 0) return [];
      if (isNil(from)) return this.candles.slice(-limit);

      const startIndex = findCandleIndexByTimestamp(this.candles, from);

      // If no candle matches (start index is at the end), return empty
      if (startIndex >= this.candles.length) return [];

      const endIndex = isNil(limit) ? this.candles.length : startIndex + limit;
      return this.candles.slice(startIndex, endIndex);
    });
  }

  public async fetchMyTrades(from?: EpochTimeStamp): Promise<Trade[]> {
    return this.mutex.runExclusive(() => {
      const arr = Array.from(this.ordersMap.values());
      const filtered = isNil(from) ? arr : arr.filter(order => order.timestamp >= from);
      return filtered.map(this.mapOrderToTrade);
    });
  }

  public async fetchBalance(): Promise<Portfolio> {
    return this.mutex.runExclusive(() => clonePortfolio(this.portfolio));
  }

  public async createLimitOrder(
    side: OrderSide,
    amount: number,
    price: number,
    onSettled?: OrderSettledCallback,
  ): Promise<OrderState> {
    return this.mutex.runExclusive(() => {
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
      this.ordersMap.set(id, order);

      if (onSettled) this.orderSettledCallbacks.set(id, onSettled);

      if (side === 'BUY') this.insertBuyOrder(order);
      else this.insertSellOrder(order);

      return this.cloneOrder(order);
    });
  }

  public async createMarketOrder(side: OrderSide, amount: number): Promise<OrderState> {
    return this.mutex.runExclusive(() => {
      const normalizedAmount = checkOrderAmount(amount, this.marketData);
      const price = side === 'BUY' ? this.ticker.ask : this.ticker.bid;
      checkOrderCost(normalizedAmount, price, this.marketData);

      const id = `order-${++this.orderSequence}`;
      const cost = normalizedAmount * price;
      const totalCost = cost * (1 + (this.marketData.fee?.taker ?? 0));

      const [asset, currency] = this.portfolio.keys();
      const currencyBalance = this.portfolio.get(currency)!;
      const assetBalance = this.portfolio.get(asset)!;

      if (side === 'BUY') {
        if (currencyBalance.free < totalCost)
          throw new InvalidOrder(
            `Insufficient currency balance (portfolio: ${currencyBalance.free}, order cost: ${totalCost})`,
          );
        currencyBalance.free -= totalCost;
        currencyBalance.total -= totalCost;
        assetBalance.free += normalizedAmount;
        assetBalance.total += normalizedAmount;
      } else {
        if (assetBalance.free < normalizedAmount)
          throw new InvalidOrder(
            `Insufficient asset balance (portfolio: ${assetBalance.free}, amount: ${normalizedAmount})`,
          );
        assetBalance.free -= normalizedAmount;
        assetBalance.total -= normalizedAmount;
        const gain = cost * (1 - (this.marketData.fee?.taker ?? 0));
        currencyBalance.free += gain;
        currencyBalance.total += gain;
      }

      // Update portfolio with modified balances
      this.portfolio.set(asset, assetBalance);
      this.portfolio.set(currency, currencyBalance);

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
      this.ordersMap.set(id, order);

      return this.cloneOrder(order);
    });
  }

  public async cancelOrder(id: string): Promise<OrderState> {
    return this.mutex.runExclusive(() => {
      const order = this.ordersMap.get(id);
      if (!order) throw new OrderNotFound(`Unknown order: ${id}`);

      if (order.status === 'open') {
        this.releaseBalance(order);
        order.status = 'canceled';
        order.timestamp = this.currentTimestamp;

        if (order.side === 'BUY') {
          const idx = this.buyOrders.indexOf(order);
          if (idx !== -1) this.buyOrders.splice(idx, 1);
        } else {
          const idx = this.sellOrders.indexOf(order);
          if (idx !== -1) this.sellOrders.splice(idx, 1);
        }

        this.notifyAndCleanupCallback(order);
      }

      return this.cloneOrder(order);
    });
  }

  public async fetchOrder(id: string): Promise<OrderState> {
    return this.mutex.runExclusive(() => {
      const order = this.ordersMap.get(id);
      if (!order) throw new OrderNotFound(`Unknown order: ${id}`);
      return this.cloneOrder(order);
    });
  }

  public getMarketData(): MarketData {
    return this.marketData;
  }

  private reserveBalance(side: OrderSide, amount: number, price: number) {
    const [asset, currency] = this.portfolio.keys();
    const currencyBalance = this.portfolio.get(currency)!;
    const assetBalance = this.portfolio.get(asset)!;

    if (side === 'BUY') {
      const cost = amount * price;
      const totalCost = cost * (1 + (this.marketData.fee?.maker ?? 0));
      if (currencyBalance.free < totalCost)
        throw new InvalidOrder(
          `Insufficient currency balance (portfolio: ${currencyBalance.free}, order cost: ${totalCost})`,
        );
      currencyBalance.free -= totalCost;
      currencyBalance.used += totalCost;
      this.portfolio.set(currency, currencyBalance);
    } else {
      if (assetBalance.free < amount)
        throw new InvalidOrder(`Insufficient asset balance (portfolio: ${assetBalance.free}, order cost: ${amount})`);
      assetBalance.free -= amount;
      assetBalance.used += amount;
      this.portfolio.set(asset, assetBalance);
    }
  }

  private releaseBalance(order: DummyInternalOrder) {
    const filled = order.filled ?? 0;
    const remaining = order.amount - filled;
    if (remaining <= 0) return;

    const [asset, currency] = this.portfolio.keys();
    const currencyBalance = this.portfolio.get(currency)!;
    const assetBalance = this.portfolio.get(asset)!;

    if (order.side === 'BUY') {
      const release = remaining * (order.price ?? 0) * (1 + (this.marketData.fee?.maker ?? 0));
      currencyBalance.free += release;
      currencyBalance.used -= release;
      this.portfolio.set(currency, currencyBalance);
    } else {
      assetBalance.free += remaining;
      assetBalance.used -= remaining;
      this.portfolio.set(asset, assetBalance);
    }
  }

  private settleOrdersWithCandle(candle: Candle) {
    // Process BUYs (descending price)
    // Matches if candle.low <= order.price
    // Since sorted DESC, all orders from 0 to splitIndex match
    let buySplitIndex = this.buyOrders.findIndex(o => (o.price ?? 0) < candle.low);
    if (buySplitIndex === -1) {
      // If not found, it means EITHER all match (all > candle.low) OR empty
      // If array is not empty, and findIndex is -1, it means ALL elements failed the condition (price < low)
      // which means ALL elements satisfy price >= low. So ALL match.
      buySplitIndex = this.buyOrders.length;
    }

    if (buySplitIndex > 0) {
      const matched = this.buyOrders.splice(0, buySplitIndex);
      for (const order of matched) {
        this.fillOrder(order, candle);
      }
    }

    // Process SELLs (ascending price)
    // Matches if candle.high >= order.price
    // Since sorted ASC, all orders from 0 to splitIndex match
    let sellSplitIndex = this.sellOrders.findIndex(o => (o.price ?? 0) > candle.high);
    if (sellSplitIndex === -1) {
      sellSplitIndex = this.sellOrders.length;
    }

    if (sellSplitIndex > 0) {
      const matched = this.sellOrders.splice(0, sellSplitIndex);
      for (const order of matched) {
        this.fillOrder(order, candle);
      }
    }
  }

  private fillOrder(order: DummyInternalOrder, _candle?: Candle) {
    if (order.status !== 'open') return;

    const price = order.price ?? 0;
    order.status = 'closed';
    order.filled = order.amount;
    order.remaining = 0;
    order.timestamp = this.currentTimestamp;

    const [asset, currency] = this.portfolio.keys();
    const currencyBalance = this.portfolio.get(currency)!;
    const assetBalance = this.portfolio.get(asset)!;

    if (order.side === 'BUY') {
      const cost = order.amount * price * (1 + (this.marketData.fee?.maker ?? 0));
      currencyBalance.used -= cost;
      currencyBalance.total -= cost;
      assetBalance.free += order.amount;
      assetBalance.total += order.amount;
    } else {
      const gain = order.amount * price * (1 - (this.marketData.fee?.maker ?? 0));
      assetBalance.used -= order.amount;
      assetBalance.total -= order.amount;
      currencyBalance.free += gain;
      currencyBalance.total += gain;
    }

    // Update portfolio with modified balances
    this.portfolio.set(asset, assetBalance);
    this.portfolio.set(currency, currencyBalance);

    this.notifyAndCleanupCallback(order);
  }

  private notifyAndCleanupCallback(order: DummyInternalOrder) {
    const callback = this.orderSettledCallbacks.get(order.id);
    if (callback) {
      callback(this.cloneOrder(order));
      this.orderSettledCallbacks.delete(order.id);
    }
  }

  private insertBuyOrder(order: DummyInternalOrder) {
    // DESC
    let low = 0,
      high = this.buyOrders.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.buyOrders[mid].price! > order.price!) low = mid + 1;
      else high = mid;
    }
    this.buyOrders.splice(low, 0, order);
  }

  private insertSellOrder(order: DummyInternalOrder) {
    // ASC
    let low = 0,
      high = this.sellOrders.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.sellOrders[mid].price! < order.price!) low = mid + 1;
      else high = mid;
    }
    this.sellOrders.splice(low, 0, order);
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
