import { ONE_MINUTE } from '@constants/time.const';
import { generateSyntheticCandle, generateSyntheticHistory } from '../fixtures/syntheticData';

export class MockCCXTExchange {
  public static simulatedGaps: { start: number; end: number }[] | Record<string, { start: number; end: number }[]> = [];
  public static shouldThrowError: boolean = false;
  public static shouldThrowOnCreateOrder: boolean = false;
  /** When true, fetchOHLCV will emit each candle twice (simulating reconnection overlap) */
  public static emitDuplicates: boolean = false;
  /** When true, fetchOHLCV will include a candle with a future timestamp (> Date.now()) */
  public static emitFutureCandles: boolean = false;
  /** When true, fetchOHLCV will skip every 3rd candle to simulate missing candles/gaps */
  public static emitWithGaps: boolean = false;
  /** When true, createOrder will return 'open' status and not fill the order immediately */
  public static simulateOpenOrders: boolean = false;
  /** Polling interval for onNewCandle (ms). Set by tests for accelerated timing. */
  public static pollingInterval: number = 60000;

  public id = 'binance';
  public name = 'binance';
  public has = {
    fetchOHLCV: true,
    fetchTickers: true,
    fetchTicker: true,
    createOrder: true,
    createLimitOrder: true,
    createMarketOrder: true,
    fetchMyTrades: true,
    fetchBalance: true,
    fetchOpenOrders: true,
    fetchOrder: true,
    cancelOrder: true,
  };

  public markets: Record<
    string,
    {
      symbol: string;
      base: string;
      quote: string;
      baseName: string;
      limits: {
        price: { min: number; max: number };
        amount: { min: number; max: number };
        cost: { min: number; max: number };
      };
      precision: { price: number; amount: number };
    }
  > = {
    'BTC/USDT': {
      symbol: 'BTC/USDT',
      base: 'BTC',
      quote: 'USDT',
      baseName: 'BTC',
      limits: {
        price: { min: 0.1, max: 1000000 },
        amount: { min: 0.0001, max: 1000 },
        cost: { min: 5, max: 1000000 },
      },
      precision: { price: 2, amount: 6 },
    },
    'ETH/USDT': {
      symbol: 'ETH/USDT',
      base: 'ETH',
      quote: 'USDT',
      baseName: 'ETH',
      limits: {
        price: { min: 0.01, max: 100000 },
        amount: { min: 0.001, max: 10000 },
        cost: { min: 5, max: 1000000 },
      },
      precision: { price: 2, amount: 6 },
    },
    'LTC/USDT': {
      symbol: 'LTC/USDT',
      base: 'LTC',
      quote: 'USDT',
      baseName: 'LTC',
      limits: {
        price: { min: 0.01, max: 100000 },
        amount: { min: 0.001, max: 10000 },
        cost: { min: 5, max: 1000000 },
      },
      precision: { price: 2, amount: 6 },
    },
  };

  constructor(_config: any) {
    // console.log('MockCCXT initialized with', _config);
  }

  async loadMarkets() {
    return this.markets;
  }

  market(symbol: string) {
    if (!this.markets[symbol]) {
      // Return default if not found
      return {
        limits: {
          price: { min: 0, max: Infinity },
          amount: { min: 0, max: Infinity },
          cost: { min: 0, max: Infinity },
        },
        precision: { price: 8, amount: 8 },
      };
    }
    return this.markets[symbol];
  }

  async fetchTickers(symbols: string[]) {
    const tickers: Record<string, any> = {};
    for (const symbol of symbols) {
      tickers[symbol] = await this.fetchTicker(symbol);
    }
    return tickers;
  }

  async fetchTicker(symbol: string) {
    const candle = generateSyntheticCandle(symbol, Date.now());
    return {
      symbol,
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
      high: candle.high,
      low: candle.low,
      bid: candle.close, // Simplify bid/ask/last to close price
      ask: candle.close,
      last: candle.close,
      close: candle.close,
      baseVolume: candle.volume,
    };
  }

  async fetchOHLCV(symbol: string, timeframe: string, since: number, limit: number) {
    // console.log(`[MockCCXT] fetchOHLCV ${symbol} since ${since} limit ${limit}`);

    if (MockCCXTExchange.shouldThrowError) {
      throw new Error('Simulated Network Error');
    }

    // Basic validation of mapped implementation
    if (timeframe !== '1m') {
      // E2E only strictly testing 1m candles for now based on spec
      // But we can generate others if needed.
    }
    const candles = generateSyntheticHistory(symbol, since || Date.now() - limit * ONE_MINUTE, limit || 100);

    // Filter out gaps logic
    const filteredCandles = candles.filter(c => {
      // Check if candle start time is strictly inside any simulated gap
      // Use static property to check gaps
      const gaps = Array.isArray(MockCCXTExchange.simulatedGaps)
        ? MockCCXTExchange.simulatedGaps
        : MockCCXTExchange.simulatedGaps[symbol] || [];

      return !gaps.some(gap => c.start >= gap.start && c.start < gap.end);
    });

    // Map objects back to array format [timestamp, open, high, low, close, volume]
    const result = filteredCandles.map(c => [c.start, c.open, c.high, c.low, c.close, c.volume]);

    // If emitDuplicates is true, duplicate each candle (simulating reconnection overlap)
    if (MockCCXTExchange.emitDuplicates) {
      return result.flatMap(candle => [candle, candle]);
    }

    // If emitFutureCandles is true, add a candle with a future timestamp
    if (MockCCXTExchange.emitFutureCandles) {
      const futureTimestamp = Date.now() + 5 * ONE_MINUTE; // 5 minutes in the future
      const futureCandle = generateSyntheticCandle(symbol, futureTimestamp);
      result.push([futureCandle.start, futureCandle.open, futureCandle.high, futureCandle.low, futureCandle.close, futureCandle.volume]);
    }

    // If emitWithGaps is true, skip every 3rd candle to simulate missing candles/gaps
    if (MockCCXTExchange.emitWithGaps) {
      return result.filter((_, index) => (index + 1) % 3 !== 0);
    }

    return result;
  }

  /**
   * Simulates realtime candle streaming via polling.
   * Uses a small polling interval for accelerated E2E testing.
   */
  onNewCandle(symbol: string, callback: (symbol: string, candle: any) => void): () => void {
    let candleIndex = 0;
    // Start from current time, aligned to minute boundary (real 60s intervals for timestamps)
    const startTime = Math.floor(Date.now() / 60000) * 60000;

    // Use static pollingInterval for testable timing control
    const POLLING_INTERVAL = MockCCXTExchange.pollingInterval;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const emitCandle = () => {
      // Calculate candle timestamp: real 60s minute intervals for timestamps
      const candleTimestamp = startTime + candleIndex * 60000;
      const candle = generateSyntheticCandle(symbol, candleTimestamp);
      callback(symbol, candle);
      candleIndex++;
    };

    // Emit first candle after a small delay, then at POLLING_INTERVAL intervals
    const timeoutId = setTimeout(() => {
      emitCandle();
      intervalId = setInterval(emitCandle, POLLING_INTERVAL);
    }, POLLING_INTERVAL);

    // Return unsubscribe function
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }

  public static mockTrades: any[] = [];

  // Private API mocks
  async fetchMyTrades(_symbol: string) {
    return MockCCXTExchange.mockTrades;
  }
  async fetchBalance() {
    return {
      USDT: { free: 10000, used: 0, total: 10000 },
      BTC: { free: 1, used: 0, total: 1 },
      ETH: { free: 10, used: 0, total: 10 },
      LTC: { free: 10, used: 0, total: 10 },
    };
  }

  async createOrder(symbol: string, type: string, side: string, amount: number, price?: number) {
    if (MockCCXTExchange.shouldThrowError || MockCCXTExchange.shouldThrowOnCreateOrder) {
      throw new Error('Simulated Network Error');
    }

    const id = Math.random().toString(36).substring(7);
    const timestamp = Date.now();
    if (MockCCXTExchange.simulateOpenOrders) {
      return {
        id,
        symbol,
        type,
        side,
        amount,
        price: price || 0,
        cost: (price || 0) * amount,
        status: 'open',
        timestamp,
        datetime: new Date(timestamp).toISOString(),
        filled: 0,
        remaining: amount,
        fee: undefined, // Fee not charged yet
        info: {},
      };
    }

    const trade = {
      id: Math.random().toString(36).substring(7),
      order: id,
      symbol,
      side,
      amount,
      price: price || 100, // Default price if market order
      cost: (price || 100) * amount,
      fee: { currency: 'USDT', cost: 0.1, rate: 0.001 },
      timestamp,
      datetime: new Date(timestamp).toISOString(),
    };
    MockCCXTExchange.mockTrades.push(trade);

    return {
      id,
      symbol,
      type,
      side,
      amount,
      price: price || 0,
      cost: (price || 0) * amount,
      status: 'closed',
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      filled: amount,
      remaining: 0,
      fee: { currency: 'USDT', cost: 0.1, rate: 0.001 },
      info: {},
    };
  }

  async cancelOrder(id: string, symbol: string) {
    return {
      id,
      symbol,
      status: 'canceled',
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
      info: {},
    };
  }

  async fetchOrder(id: string, symbol: string) {
    return {
      id,
      symbol,
      status: 'closed',
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
      amount: 1,
      filled: 1,
      remaining: 0,
      price: 100,
      cost: 100,
      type: 'limit',
      side: 'buy',
      info: {},
    };
  }

  async fetchOpenOrders(_symbol: string) {
    return [];
  }
}
