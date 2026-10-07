import { UUID } from 'node:crypto';
import { bench, describe } from 'vitest';
import { SMACrossover } from './smaCrossover.strategy';

const symbol = 'BTC/USDT';

const createMockTools = () => {
  const pending: UUID[] = [];
  let count = 0;
  return {
    strategyParams: { period: 20, src: 'close' as const },
    createOrder: () => {
      const id = `00000000-0000-0000-0000-${String(++count).padStart(12, '0')}` as UUID;
      pending.push(id);
      return id;
    },
    cancelOrder: () => {},
    log: () => {},
    // The strategy skips a crossover while its own order is pending: completing every order once the candle is processed keeps the
    // oscillating benchmarks measuring crossovers
    completeOrders: (strategy: SMACrossover) => {
      for (const id of pending.splice(0)) strategy.onOrderCompleted({ order: { id } } as any);
    },
  };
};

const createCandle = (close: number) => ({
  close,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  volume: 1000,
  start: new Date(),
});

// Generate candle sequences that cause crossovers
const generateOscillatingCandles = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const c = new Map();
    c.set(symbol, createCandle(100 + (i % 2 === 0 ? -10 : 10)));
    return c;
  });

const generateTrendingCandles = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const c = new Map();
    c.set(symbol, createCandle(100 + i));
    return c;
  });

const makeIndicator = (res: number) => [{ results: res, symbol }] as any;

describe('SMACrossover Strategy Performance', () => {
  describe('onTimeframeCandleAfterWarmup', () => {
    bench('10 candles - oscillating (frequent crossovers)', () => {
      const strategy = new SMACrossover();
      const tools = createMockTools();
      const addIndicator = () => {};
      const candles = generateOscillatingCandles(10);
      strategy.init({ candle: candles[0], tools, addIndicator } as any);

      for (const candle of candles) {
        strategy.onTimeframeCandleAfterWarmup({ candle, tools } as any, ...makeIndicator(100));
        tools.completeOrders(strategy);
      }
    });

    bench('100 candles - oscillating (frequent crossovers)', () => {
      const strategy = new SMACrossover();
      const tools = createMockTools();
      const addIndicator = () => {};
      const candles = generateOscillatingCandles(100);
      strategy.init({ candle: candles[0], tools, addIndicator } as any);

      for (const candle of candles) {
        strategy.onTimeframeCandleAfterWarmup({ candle, tools } as any, ...makeIndicator(100));
        tools.completeOrders(strategy);
      }
    });

    bench('1000 candles - oscillating (frequent crossovers)', () => {
      const strategy = new SMACrossover();
      const tools = createMockTools();
      const addIndicator = () => {};
      const candles = generateOscillatingCandles(1000);
      strategy.init({ candle: candles[0], tools, addIndicator } as any);

      for (const candle of candles) {
        strategy.onTimeframeCandleAfterWarmup({ candle, tools } as any, ...makeIndicator(100));
        tools.completeOrders(strategy);
      }
    });

    bench('1000 candles - trending (no crossovers)', () => {
      const strategy = new SMACrossover();
      const tools = createMockTools();
      const addIndicator = () => {};
      const candles = generateTrendingCandles(1000);
      strategy.init({ candle: candles[0], tools, addIndicator } as any);

      for (const candle of candles) {
        strategy.onTimeframeCandleAfterWarmup({ candle, tools } as any, ...makeIndicator(50)); // SMA always below price
        tools.completeOrders(strategy);
      }
    });
  });

  describe('init', () => {
    bench('init strategy', () => {
      const strategy = new SMACrossover();
      const tools = createMockTools();
      const addIndicator = () => {};
      const candles = generateTrendingCandles(1);

      strategy.init({ tools, addIndicator, candle: candles[0] } as any);
    });
  });

  describe('log', () => {
    bench('log 1000 candles', () => {
      const strategy = new SMACrossover();
      const tools = createMockTools();
      const addIndicator = () => {};
      const candles = generateTrendingCandles(1000);
      strategy.init({ candle: candles[0], tools, addIndicator } as any);

      for (const candle of candles) {
        strategy.log({ candle, tools } as any, ...makeIndicator(100));
      }
    });
  });
});
