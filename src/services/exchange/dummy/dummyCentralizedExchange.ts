import { Candle } from '@models/candle.types';
import { CandleBucket } from '@models/event.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Trade } from '@models/trade.types';
import { TradingPair } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { LIMITS } from '@services/exchange/exchange.const';
import { InvalidOrder, OrderNotFound } from '@services/exchange/exchange.error';
import { Exchange, FetchOHLCVParams, MarketData, OrderSettledCallback, Ticker } from '@services/exchange/exchange.types';
import { clonePortfolio, initializePortfolio } from '@utils/portfolio/portfolio.utils';
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
  private readonly candles: Map<TradingPair, Candle[]>;
  private readonly marketData: Map<TradingPair, MarketData>;
  private readonly portfolio: Portfolio;
  private ticker: Map<TradingPair, Ticker | undefined>;
  private currentTimestamp: EpochTimeStamp;
  private orderSequence = 0;

  constructor(exchangeConfig: DummyCentralizedExchangeConfig) {
    const { marketData, simulationBalance, initialTicker } = exchangeConfig;
    const { pairs, daterange } = config.getWatch();
    this.marketData = marketData;
    this.portfolio = initializePortfolio(
      pairs.map(pair => pair.symbol),
      simulationBalance,
    );
    this.ticker = new Map(pairs.map(pair => [pair.symbol, initialTicker.get(pair.symbol)]));
    this.ordersMap = new Map();
    this.orderSettledCallbacks = new Map();
    this.candles = new Map();
    this.buyOrders = [];
    this.sellOrders = [];
    this.currentTimestamp = daterange?.start ? daterange.start : Date.now();

    bindAll(this, [this.mapOrderToTrade.name]);
  }

  public getExchangeName(): string {
    return 'dummy-cex';
  }

  /** Because dummy exchange is not a plugin, I need to call this function manually in the plugins stream */
  public async processOneMinuteBucket(bucket: CandleBucket): Promise<void> {
    return this.mutex.runExclusive(() => {
      for (const [symbol, candle] of bucket) {
        // I need the close time of the candle
        this.currentTimestamp = addMinutes(candle.start, 1).getTime();
        const oldCandles = this.candles.get(symbol);
        if (oldCandles) oldCandles.push(candle);
        else this.candles.set(symbol, [candle]);
        this.ticker.set(symbol, { bid: candle.close, ask: candle.close });
        this.settleOrdersWithCandle(symbol, candle);
      }
    });
  }

  public async loadMarkets(): Promise<void> {
    // Nothing to do, already done in constructor
  }

  /**
   * Warning: if you fetch tickers before the first candle is processed, it will return { bid: 0, ask: 0 }.
   * Unless you set the initialTicker in configuration.
   */
  public async fetchTickers(symbols: TradingPair[]): Promise<Record<TradingPair, Ticker>> {
    return this.mutex.runExclusive(() =>
      symbols.reduce(
        (acc, symbol) => ({ ...acc, [symbol]: this.ticker.get(symbol) ?? { bid: 0, ask: 0 } }),
        {} as Record<TradingPair, Ticker>,
      ),
    );
  }

  /**
   * Warning: if you fetch the ticker before the first candle is processed, it will return { bid: 0, ask: 0 }.
   * Unless you set the initialTicker in configuration.
   */
  public async fetchTicker(symbol: TradingPair): Promise<Ticker> {
    return this.mutex.runExclusive(() => ({ ...(this.ticker.get(symbol) ?? { bid: 0, ask: 0 }) }));
  }

  public async fetchOHLCV(symbol: TradingPair, params: FetchOHLCVParams = {}): Promise<Candle[]> {
    return this.mutex.runExclusive(() => {
      const { from, limit = LIMITS[this.getExchangeName()].candles } = params;
      const candles = this.candles.get(symbol) ?? [];
      if (candles.length === 0) return [];
      if (isNil(from)) return candles.slice(-limit);

      const startIndex = findCandleIndexByTimestamp(candles, from);

      // If no candle matches (start index is at the end), return empty
      if (startIndex >= candles.length) return [];

      const endIndex = isNil(limit) ? candles.length : startIndex + limit;
      return candles.slice(startIndex, endIndex);
    });
  }

  public async fetchMyTrades(symbol: TradingPair, from?: EpochTimeStamp): Promise<Trade[]> {
    return this.mutex.runExclusive(() => {
      const arr = Array.from(this.ordersMap.values());
      const filtered = isNil(from) ? arr : arr.filter(order => order.timestamp >= from && order.symbol === symbol);
      return filtered.map(this.mapOrderToTrade);
    });
  }

  public async fetchBalance(): Promise<Portfolio> {
    return this.mutex.runExclusive(() => clonePortfolio(this.portfolio));
  }

  public async createLimitOrder(
    symbol: TradingPair,
    side: OrderSide,
    amount: number,
    price: number,
    onSettled?: OrderSettledCallback,
  ): Promise<OrderState> {
    return this.mutex.runExclusive(() => {
      const checkedPrice = checkOrderPrice(price, this.marketData.get(symbol)!);
      const normalizedAmount = checkOrderAmount(amount, this.marketData.get(symbol)!);
      checkOrderCost(normalizedAmount, checkedPrice, this.marketData.get(symbol)!);

      this.reserveBalance(symbol, side, normalizedAmount, checkedPrice);

      const id = `order-${++this.orderSequence}`;
      const order: DummyInternalOrder = {
        id,
        symbol,
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

  public async createMarketOrder(symbol: TradingPair, side: OrderSide, amount: number): Promise<OrderState> {
    return this.mutex.runExclusive(() => {
      const normalizedAmount = checkOrderAmount(amount, this.marketData.get(symbol)!);
      const price = side === 'BUY' ? this.ticker.get(symbol)?.ask : this.ticker.get(symbol)?.bid;
      if (isNil(price)) throw new InvalidOrder(`Ticker not found for symbol ${symbol}`);

      checkOrderCost(normalizedAmount, price, this.marketData.get(symbol)!);

      const id = `order-${++this.orderSequence}`;
      const cost = normalizedAmount * price;
      const totalCost = cost * (1 + (this.marketData.get(symbol)?.fee?.taker ?? 0));

      const [asset, currency] = symbol.split('/');
      const currencyBalance = this.portfolio.get(currency)!;
      const assetBalance = this.portfolio.get(asset)!;

      if (side === 'BUY') {
        if (currencyBalance.free < totalCost)
          throw new InvalidOrder(`Insufficient currency balance (portfolio: ${currencyBalance.free}, order cost: ${totalCost})`);
        currencyBalance.free -= totalCost;
        currencyBalance.total -= totalCost;
        assetBalance.free += normalizedAmount;
        assetBalance.total += normalizedAmount;
      } else {
        if (assetBalance.free < normalizedAmount)
          throw new InvalidOrder(`Insufficient asset balance (portfolio: ${assetBalance.free}, amount: ${normalizedAmount})`);
        assetBalance.free -= normalizedAmount;
        assetBalance.total -= normalizedAmount;
        const gain = cost * (1 - (this.marketData.get(symbol)?.fee?.taker ?? 0));
        currencyBalance.free += gain;
        currencyBalance.total += gain;
      }

      // Update portfolio with modified balances
      this.portfolio.set(asset, assetBalance);
      this.portfolio.set(currency, currencyBalance);

      const order: DummyInternalOrder = {
        id,
        symbol,
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

  public async cancelOrder(symbol: TradingPair, id: string): Promise<OrderState> {
    return this.mutex.runExclusive(() => {
      const order = this.ordersMap.get(id);
      if (!order) throw new OrderNotFound(`Unknown order: ${id}`);

      if (order.status === 'open') {
        this.releaseBalance(symbol, order);
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

  public async fetchOrder(_symbol: TradingPair, id: string): Promise<OrderState> {
    return this.mutex.runExclusive(() => {
      const order = this.ordersMap.get(id);
      if (!order) throw new OrderNotFound(`Unknown order: ${id}`);
      return this.cloneOrder(order);
    });
  }

  public getMarketData(symbol: TradingPair): MarketData {
    return this.marketData.get(symbol) ?? {};
  }

  private reserveBalance(symbol: TradingPair, side: OrderSide, amount: number, price: number) {
    const [asset, currency] = symbol.split('/');
    const currencyBalance = this.portfolio.get(currency)!;
    const assetBalance = this.portfolio.get(asset)!;

    if (side === 'BUY') {
      const cost = amount * price;
      const totalCost = cost * (1 + (this.marketData.get(symbol)?.fee?.maker ?? 0));
      if (currencyBalance.free < totalCost)
        throw new InvalidOrder(`Insufficient currency balance (portfolio: ${currencyBalance.free}, order cost: ${totalCost})`);
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

  private releaseBalance(symbol: TradingPair, order: DummyInternalOrder) {
    const filled = order.filled ?? 0;
    const remaining = order.amount - filled;
    if (remaining <= 0) return;

    const [asset, currency] = symbol.split('/');
    const currencyBalance = this.portfolio.get(currency)!;
    const assetBalance = this.portfolio.get(asset)!;

    if (order.side === 'BUY') {
      const release = remaining * (order.price ?? 0) * (1 + (this.marketData.get(symbol)?.fee?.maker ?? 0));
      currencyBalance.free += release;
      currencyBalance.used -= release;
      this.portfolio.set(currency, currencyBalance);
    } else {
      assetBalance.free += remaining;
      assetBalance.used -= remaining;
      this.portfolio.set(asset, assetBalance);
    }
  }

  private settleOrdersWithCandle(symbol: TradingPair, candle: Candle) {
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
        this.fillOrder(symbol, order, candle);
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
        this.fillOrder(symbol, order, candle);
      }
    }
  }

  private fillOrder(symbol: TradingPair, order: DummyInternalOrder, _candle?: Candle) {
    if (order.status !== 'open') return;

    const price = order.price ?? 0;
    order.status = 'closed';
    order.filled = order.amount;
    order.remaining = 0;
    order.timestamp = this.currentTimestamp;

    const [asset, currency] = symbol.split('/');
    const currencyBalance = this.portfolio.get(currency)!;
    const assetBalance = this.portfolio.get(asset)!;

    if (order.side === 'BUY') {
      const cost = order.amount * price * (1 + (this.marketData.get(symbol)?.fee?.maker ?? 0));
      currencyBalance.used -= cost;
      currencyBalance.total -= cost;
      assetBalance.free += order.amount;
      assetBalance.total += order.amount;
    } else {
      const gain = order.amount * price * (1 - (this.marketData.get(symbol)?.fee?.maker ?? 0));
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
    const fee = this.marketData.get(order.symbol)?.fee;
    const feeRate = order.type === 'MARKET' ? (fee?.taker ?? 0) : (fee?.maker ?? 0);

    return {
      id: order.id,
      amount: order.filled ?? 0,
      price: order.price ?? 0,
      timestamp: order.timestamp,
      fee: { rate: feeRate * 100 },
    };
  }
}
