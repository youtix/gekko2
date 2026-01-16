import type { Candle } from '@models/candle.types';
import type { BalanceDetail, Portfolio } from '@models/portfolio.types';
import type { MarketData } from '@services/exchange/exchange.types';
import type { UUID } from 'node:crypto';
import { bench, describe } from 'vitest';
import { GridBot } from './gridBot.strategy';
import type { GridBotStrategyParams } from './gridBot.types';

const marketData: MarketData = {
  precision: { price: 0.01, amount: 0.001 },
  amount: { min: 0.001, max: 1000 },
};

const balancedPortfolio: Portfolio = new Map<string, BalanceDetail>([
  ['asset', { free: 50, used: 0, total: 50 }],
  ['currency', { free: 5000, used: 0, total: 5000 }],
]);

const makeCandle = (close: number): Candle =>
  ({
    start: 0,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }) as Candle;

const createMockTools = (params: GridBotStrategyParams) => ({
  strategyParams: params,
  marketData,
  createOrder: () => `order-${Math.random()}` as UUID,
  cancelOrder: () => {},
  log: () => {},
});

describe('GridBot Strategy Performance', () => {
  describe('init', () => {
    bench('initialize with 5 buy + 5 sell levels', () => {
      const strategy = new GridBot();
      const params: GridBotStrategyParams = {
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'fixed',
        spacingValue: 5,
      };

      strategy.init({
        candle: makeCandle(100),
        portfolio: balancedPortfolio,
        tools: createMockTools(params),
        addIndicator: () => {},
      } as any);
    });

    bench('initialize with 10 buy + 10 sell levels', () => {
      const strategy = new GridBot();
      const params: GridBotStrategyParams = {
        buyLevels: 10,
        sellLevels: 10,
        spacingType: 'fixed',
        spacingValue: 2,
      };

      strategy.init({
        candle: makeCandle(100),
        portfolio: balancedPortfolio,
        tools: createMockTools(params),
        addIndicator: () => {},
      } as any);
    });

    bench('initialize with logarithmic spacing', () => {
      const strategy = new GridBot();
      const params: GridBotStrategyParams = {
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'logarithmic',
        spacingValue: 0.02,
      };

      strategy.init({
        candle: makeCandle(100),
        portfolio: balancedPortfolio,
        tools: createMockTools(params),
        addIndicator: () => {},
      } as any);
    });
  });

  describe('onEachTimeframeCandle', () => {
    bench('100 candle updates in range', () => {
      const strategy = new GridBot();
      const params: GridBotStrategyParams = {
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'fixed',
        spacingValue: 5,
      };
      const tools = createMockTools(params);

      strategy.init({
        candle: makeCandle(100),
        portfolio: balancedPortfolio,
        tools,
        addIndicator: () => {},
      } as any);

      for (let i = 0; i < 100; i++) {
        strategy.onEachTimeframeCandle({
          candle: makeCandle(100 + ((i % 10) - 5)),
          portfolio: balancedPortfolio,
          tools,
        } as any);
      }
    });

    bench('100 candle updates out of range', () => {
      const strategy = new GridBot();
      const params: GridBotStrategyParams = {
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'fixed',
        spacingValue: 5,
      };
      const tools = createMockTools(params);

      strategy.init({
        candle: makeCandle(100),
        portfolio: balancedPortfolio,
        tools,
        addIndicator: () => {},
      } as any);

      for (let i = 0; i < 100; i++) {
        strategy.onEachTimeframeCandle({
          candle: makeCandle(150),
          portfolio: balancedPortfolio,
          tools,
        } as any);
      }
    });
  });

  describe('onOrderCompleted', () => {
    bench('100 order completions', () => {
      const strategy = new GridBot();
      const params: GridBotStrategyParams = {
        buyLevels: 5,
        sellLevels: 5,
        spacingType: 'fixed',
        spacingValue: 5,
      };
      const tools = createMockTools(params);

      strategy.init({
        candle: makeCandle(100),
        portfolio: balancedPortfolio,
        tools,
        addIndicator: () => {},
      } as any);

      for (let i = 0; i < 100; i++) {
        strategy.onOrderCompleted({
          order: { id: `unknown-${i}` as UUID, side: 'BUY' } as any,
          exchange: { price: 100, balance: { free: 0, used: 0, total: 0 }, portfolio: balancedPortfolio },
          tools,
        } as any);
      }
    });
  });
});
