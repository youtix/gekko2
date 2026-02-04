import { ONE_MINUTE } from '@constants/time.const';
import { generateSyntheticCandle, generateSyntheticHistory } from '../fixtures/syntheticData';

export class MockCCXTExchange {
  public static simulatedGaps: { start: number; end: number }[] | Record<string, { start: number; end: number }[]> = [];
  public static shouldThrowError: boolean = false;

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
    return filteredCandles.map(c => [c.start, c.open, c.high, c.low, c.close, c.volume]);
  }

  // Private API mocks
  async fetchMyTrades(_symbol: string) {
    return [];
  }
  async fetchBalance() {
    return {
      USDT: { free: 10000, used: 0, total: 10000 },
      BTC: { free: 1, used: 0, total: 1 },
      ETH: { free: 10, used: 0, total: 10 },
    };
  }
}
