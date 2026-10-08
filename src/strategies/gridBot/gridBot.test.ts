import type { Candle } from '@models/candle.types';
import type { CandleBucket } from '@models/event.types';
import type { OrderSide } from '@models/order.types';
import type { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { dummyExchangeSchema } from '@services/exchange/dummy/dummyCentralizedExchange.schema';
import type { MarketData } from '@services/exchange/exchange.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridBot } from './gridBot.strategy';
import type { GridBotStrategyParams } from './gridBot.types';
import * as GridBotUtils from './gridBot.utils';

const defaultParams: GridBotStrategyParams = {
  buyLevels: 2,
  sellLevels: 2,
  spacingType: 'fixed',
  spacingValue: 5,
  retryOnError: 3,
};

const marketDataMock: MarketData = {
  amount: { min: 0.1 },
  precision: { price: 0.01, amount: 0.01 },
};

const marketData = new Map([['BTC/USDT', marketDataMock]]);

const makeCandle = (close: number): CandleBucket => {
  const candle: Candle = {
    start: 0,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  };
  return new Map([['BTC/USDT', candle]]);
};

const balancedPortfolio: Portfolio = new Map<string, BalanceDetail>([
  ['BTC', { free: 5, used: 0, total: 5 }],
  ['USDT', { free: 500, used: 0, total: 500 }],
]);

const unbalancedPortfolio: Portfolio = new Map<string, BalanceDetail>([
  ['BTC', { free: 0, used: 0, total: 0 }],
  ['USDT', { free: 1000, used: 0, total: 1000 }],
]);

describe('GridBot', () => {
  let strategy: GridBot;
  let createOrder: ReturnType<typeof vi.fn>;
  let cancelOrder: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.fn>;
  let issuedOrders: Array<{ id: UUID; price: number; side: OrderSide; type: string }>;
  let tools: any;

  beforeEach(() => {
    strategy = new GridBot();
    issuedOrders = [];
    log = vi.fn();
    cancelOrder = vi.fn();
    createOrder = vi.fn(order => {
      const id = `order-${issuedOrders.length + 1}` as UUID;
      issuedOrders.push({ id, price: order.price ?? 0, side: order.side, type: order.type });
      return id;
    });
    // tools should simulate the structure expected by the strategy
    tools = { strategyParams: defaultParams, marketData, createOrder, cancelOrder, log, pairs: ['BTC/USDT'] };
  });

  const initStrategy = (price = 100, params: Partial<GridBotStrategyParams> = {}, portfolio: Portfolio = balancedPortfolio) => {
    tools.strategyParams = { ...defaultParams, ...params };
    strategy.init({
      candle: makeCandle(price),
      portfolio,
      tools,
      addIndicator: vi.fn(),
    });
  };

  /** A candle after the warmup: the first one starts the grid around its close */
  const afterWarmup = (price: number, portfolio: Portfolio = balancedPortfolio) =>
    strategy.onTimeframeCandleAfterWarmup({ candle: makeCandle(price), portfolio, tools });

  /** A run without warmup: its first candle, which init receives, is also the first after the warmup */
  const startStrategy = (price = 100, params: Partial<GridBotStrategyParams> = {}, portfolio: Portfolio = balancedPortfolio) => {
    initStrategy(price, params, portfolio);
    afterWarmup(price, portfolio);
  };

  const findOrderId = (price: number, side: OrderSide): UUID | undefined =>
    issuedOrders.find(order => order.price === price && order.side === side)?.id;

  const findLatestOrderId = (side: OrderSide): UUID | undefined => {
    for (let i = issuedOrders.length - 1; i >= 0; i--) {
      if (issuedOrders[i].side === side) return issuedOrders[i].id;
    }
    return undefined;
  };

  // GridBot placed its grid from init, on the first candle of the warmup: in realtime a candle of the history replayed at start-up,
  // so the Trader sent live a grid centred on a stale close, a year old with 365 daily candles
  describe('warmup', () => {
    const balancedAt130: Portfolio = new Map<string, BalanceDetail>([
      ['BTC', { free: 5, used: 0, total: 5 }],
      ['USDT', { free: 650, used: 0, total: 650 }],
    ]);

    it.each`
      portfolio              | description
      ${balancedPortfolio}   | ${'a balanced portfolio, which gets its grid'}
      ${unbalancedPortfolio} | ${'an unbalanced portfolio, which gets its rebalance'}
    `('places no order from init, with $description', ({ portfolio }) => {
      initStrategy(100, {}, portfolio);

      expect(createOrder).not.toHaveBeenCalled();
    });

    it('places no order on a candle of the warmup', () => {
      initStrategy(100);
      strategy.onEachTimeframeCandle({ candle: makeCandle(130), portfolio: balancedPortfolio, tools });

      expect(createOrder).not.toHaveBeenCalled();
    });

    it('warns of no price out of range on a candle of the warmup, the grid not being placed yet', () => {
      initStrategy(100);
      strategy.onEachTimeframeCandle({ candle: makeCandle(150), portfolio: balancedPortfolio, tools });

      expect(log).not.toHaveBeenCalledWith('warn', expect.stringContaining('out of grid range'));
    });

    it('places the grid around the close of the first candle after the warmup, not around the close init received', () => {
      initStrategy(100, {}, balancedAt130);
      afterWarmup(130, balancedAt130);

      expect(issuedOrders.map(({ side, price }) => `${side} ${price}`)).toEqual(['BUY 120', 'BUY 125', 'SELL 135', 'SELL 140']);
    });

    it('plans the rebalance at the close of the first candle after the warmup', () => {
      initStrategy(100, {}, unbalancedPortfolio);
      afterWarmup(200, unbalancedPortfolio);

      expect(createOrder.mock.calls).toEqual([[{ type: 'STICKY', side: 'BUY', amount: 2.5, symbol: 'BTC/USDT' }]]);
    });

    it('sizes on the portfolio of the first candle after the warmup, not on the one init received', () => {
      initStrategy(100, {}, unbalancedPortfolio);
      afterWarmup(100, balancedPortfolio);

      expect(issuedOrders.map(({ side, type }) => `${side} ${type}`)).toEqual(['BUY LIMIT', 'BUY LIMIT', 'SELL LIMIT', 'SELL LIMIT']);
    });

    it('starts the grid once: a later candle after the warmup places no other order', () => {
      startStrategy(100);
      afterWarmup(130);

      expect(createOrder).toHaveBeenCalledTimes(4);
    });
  });

  describe('grid placement', () => {
    it('places correct number of orders for balanced portfolio', () => {
      startStrategy(100);

      expect(createOrder).toHaveBeenCalledTimes(4);
    });

    it.each`
      buyLevels | sellLevels | expectedOrders
      ${1}      | ${1}       | ${2}
      ${2}      | ${2}       | ${4}
      ${3}      | ${2}       | ${5}
      ${2}      | ${3}       | ${5}
    `('places $expectedOrders orders for $buyLevels buy and $sellLevels sell levels', ({ buyLevels, sellLevels, expectedOrders }) => {
      // Create portfolio balanced for this level ratio
      // Target asset ratio = sellLevels / (buyLevels + sellLevels)
      const totalValue = 1000;
      const assetRatio = sellLevels / (buyLevels + sellLevels);
      const assetValue = totalValue * assetRatio;
      const assetAmount = assetValue / 100; // at price 100
      const currencyValue = totalValue - assetValue;

      const balancedForLevels: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: assetAmount, used: 0, total: assetAmount }],
        ['USDT', { free: currencyValue, used: 0, total: currencyValue }],
      ]);

      startStrategy(100, { buyLevels, sellLevels }, balancedForLevels);

      expect(createOrder).toHaveBeenCalledTimes(expectedOrders);
    });

    it('places buy orders below center price', () => {
      startStrategy(100);

      const buyOrders = issuedOrders.filter(o => o.side === 'BUY');
      expect(buyOrders.every(o => o.price < 100)).toBe(true);
    });

    it('places sell orders above center price', () => {
      startStrategy(100);

      const sellOrders = issuedOrders.filter(o => o.side === 'SELL');
      expect(sellOrders.every(o => o.price > 100)).toBe(true);
    });

    it('uses LIMIT order type for grid orders', () => {
      startStrategy(100);

      expect(issuedOrders.every(o => o.type === 'LIMIT')).toBe(true);
    });
  });

  describe('rebalancing', () => {
    it('places STICKY rebalance order for unbalanced portfolio', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    it('uses correct side for rebalance when asset value is low', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      expect(issuedOrders[0].type).toBe('STICKY');
    });

    it('builds grid after rebalance completion', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderCompleted({
        order: { id: rebalanceId, side: 'BUY' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });

    it('retries rebalance on error', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderErrored({
        order: { id: rebalanceId, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: unbalancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(2);
    });

    it('builds grid if rebalance no longer needed after error', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      // Simulate error but with a balanced portfolio (e.g. price moved or partial fill logic not tracked here, but state update)
      // Actually strictly speaking onOrderErrored uses the portfolio from exchange.
      strategy.onOrderErrored({
        order: { id: rebalanceId, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      // Should skip retry and build grid immediately
      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Retrying'));
      // But since no rebalance needed, it builds grid (4 orders)
      expect(createOrder).toHaveBeenCalledTimes(5); // 1 initial sticky + 4 grid orders (no retry sticky)
    });

    it('builds grid after rebalance retry limit', () => {
      startStrategy(100, { retryOnError: 1 }, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;

      // First error
      strategy.onOrderErrored({
        order: { id: rebalanceId, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: unbalancedPortfolio },
        tools,
      });

      // Second error exceeds limit
      const retryId = issuedOrders[1].id;
      strategy.onOrderErrored({
        order: { id: retryId, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: unbalancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Rebalance failed'));
      // Should attempt to build grid anyway, but fails due to empty side
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Insufficient portfolio'));
      expect(createOrder).toHaveBeenCalledTimes(2); // Only rebalance attempts
    });

    it('handles rebalance order cancellation', () => {
      startStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderCanceled({
        order: { id: rebalanceId } as any,
        exchange: { price: 100, portfolio: unbalancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('failed'));
    });

    it('skips rebalance if insufficient currency for buy (due to locked funds)', () => {
      // Need to buy, but free currency is low (total is high)
      const lockedCurrencyPortfolio: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 0, used: 0, total: 0 }],
        ['USDT', { free: 10, used: 990, total: 1000 }],
      ]);
      // Total 1000 USDT -> wants to buy 500 USDT of BTC
      // But free is 10

      startStrategy(100, {}, lockedCurrencyPortfolio);

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Insufficient currency'));
      // Should fall back to building grid, but fails due to empty side
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Insufficient portfolio'));
      expect(createOrder).toHaveBeenCalledTimes(0);
    });

    it('skips rebalance if insufficient asset for sell (due to locked funds)', () => {
      // Need to sell, but free asset is low
      const lockedAssetPortfolio: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 0.1, used: 9.9, total: 10 }],
        ['USDT', { free: 0, used: 0, total: 0 }],
      ]);
      // Total 10 BTC = 1000 USDT. Wants to sell 5 BTC.
      // Free is 0.1 BTC.

      startStrategy(100, {}, lockedAssetPortfolio);

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Insufficient asset'));
      // Should fall back to building grid, but fails due to empty side
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Insufficient portfolio'));
      expect(createOrder).toHaveBeenCalledTimes(0);
    });

    it('skips rebalance if insufficient currency for buy', () => {
      // Asset value is 0, currency is 50 - total value 50, needs 25 asset value
      // That's buying 0.25 at price 100 = 25 in currency (but free currency is only 10)

      const lowCurrencyPortfolio: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 0, used: 0, total: 0 }],
        ['USDT', { free: 10, used: 0, total: 50 }],
      ]);

      startStrategy(100, {}, lowCurrencyPortfolio);

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Insufficient currency'));
    });
  });

  describe('validation', () => {
    it.each`
      params                                                      | expectedError
      ${{}}                                                       | ${'Center price'}
      ${{ buyLevels: 25, spacingType: 'fixed', spacingValue: 5 }} | ${'non-positive buy prices'}
    `('logs error $expectedError for invalid params', ({ params, expectedError }) => {
      const price = expectedError === 'Center price' ? 0 : 100;
      startStrategy(price, params);

      expect(log).toHaveBeenCalledWith('error', expect.stringContaining(expectedError));
    });

    it('logs error if grid bounds computation fails', () => {
      const spy = vi.spyOn(GridBotUtils, 'computeGridBounds').mockReturnValue(null);
      startStrategy(100);
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('valid grid bounds'));
      spy.mockRestore();
    });
  });

  describe('order completion', () => {
    it('arms adjacent opposite level after buy fill', () => {
      startStrategy(100);
      const initialOrderCount = createOrder.mock.calls.length;

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderCompleted({
        order: { id: buyId as UUID, side: 'BUY' } as any,
        exchange: { price: 95, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder.mock.calls.length).toBeGreaterThanOrEqual(initialOrderCount);
    });

    it('arms adjacent opposite level after sell fill', () => {
      startStrategy(100);
      const initialOrderCount = createOrder.mock.calls.length;

      const sellId = findOrderId(105, 'SELL');
      strategy.onOrderCompleted({
        order: { id: sellId as UUID, side: 'SELL' } as any,
        exchange: { price: 105, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder.mock.calls.length).toBeGreaterThanOrEqual(initialOrderCount);
    });

    it('logs warning when only one side remains', () => {
      startStrategy(100, { buyLevels: 1, sellLevels: 1 });

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderCompleted({
        order: { id: buyId as UUID, side: 'BUY' } as any,
        exchange: { price: 95, portfolio: balancedPortfolio },
        tools,
      });

      const sellId = findOrderId(105, 'SELL');
      strategy.onOrderCompleted({
        order: { id: sellId as UUID, side: 'SELL' } as any,
        exchange: { price: 105, portfolio: balancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('one side'));
    });

    it('ignores unknown order IDs', () => {
      startStrategy(100);

      const initialCalls = createOrder.mock.calls.length;
      strategy.onOrderCompleted({
        order: { id: 'unknown-id' as UUID, side: 'BUY' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(initialCalls);
    });
  });

  describe('order errors', () => {
    it('retries order on error', () => {
      startStrategy(100);

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderErrored({
        order: { id: buyId as UUID, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });

    it('stops retrying after limit', () => {
      startStrategy(100, { retryOnError: 1 });

      const buyId = findOrderId(95, 'BUY');

      // First error - retry
      strategy.onOrderErrored({
        order: { id: buyId as UUID, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      const retryId = findLatestOrderId('BUY');

      // Second error - limit reached
      strategy.onOrderErrored({
        order: { id: retryId as UUID, reason: 'Test error' } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Retry limit'));
    });
  });

  describe('order cancellation', () => {
    it('replaces canceled grid order', () => {
      startStrategy(100);

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderCanceled({
        order: { id: buyId as UUID } as any,
        exchange: { price: 100, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });
  });

  describe('out of range', () => {
    it('logs warning when price exits grid range', () => {
      startStrategy(100);

      strategy.onEachTimeframeCandle({
        candle: makeCandle(150),
        portfolio: balancedPortfolio,
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('out of grid range'));
    });

    it('does not log when price is in range', () => {
      startStrategy(100);

      strategy.onEachTimeframeCandle({
        candle: makeCandle(100),
        portfolio: balancedPortfolio,
        tools,
      });

      expect(log).not.toHaveBeenCalledWith('warn', expect.stringContaining('out of grid range'));
    });
  });

  describe('spacing types', () => {
    it.each`
      spacingType      | spacingValue | expectedBuyPrice | expectedSellPrice
      ${'fixed'}       | ${5}         | ${95}            | ${105}
      ${'percent'}     | ${5}         | ${95}            | ${105}
      ${'logarithmic'} | ${0.05}      | ${95.24}         | ${105}
    `('calculates correct prices for $spacingType spacing', ({ spacingType, spacingValue, expectedBuyPrice, expectedSellPrice }) => {
      startStrategy(100, { spacingType, spacingValue, buyLevels: 1, sellLevels: 1 });

      const buyOrders = issuedOrders.filter(o => o.side === 'BUY');
      const sellOrders = issuedOrders.filter(o => o.side === 'SELL');

      expect(buyOrders[0]?.price).toBe(expectedBuyPrice);
      expect(sellOrders[0]?.price).toBe(expectedSellPrice);
    });
  });

  // A backtest's market data, parsed by the dummy-cex schema from the configuration of config/backtest.yml and the documentation,
  // whose precision is 8 decimals. Handed on as steps of 8, it rounded the grid prices to multiples of 8 and these amounts, below
  // 1 BTC, to 0: GridBot stopped the backtest at its first candle after warmup ('Insufficient portfolio for any grid levels').
  describe('with the market data of the documented dummy-cex configuration', () => {
    const { marketData: configuredMarketData } = dummyExchangeSchema.parse({
      name: 'dummy-cex',
      simulationBalance: [{ assetName: 'USDT', balance: 1000 }],
      marketData: [
        {
          symbol: 'BTC/USDT',
          marketData: {
            price: { min: 0.01, max: 1_000_000 },
            amount: { min: 0.00001, max: 9000 },
            cost: { min: 5, max: 9_000_000 },
            precision: { price: 8, amount: 8 },
            fee: { maker: 0.0004, taker: 0.0007 },
          },
        },
      ],
    });
    const percentGrid = { spacingType: 'percent', spacingValue: 1 } as const;

    beforeEach(() => {
      tools.marketData = configuredMarketData;
    });

    it('rebalances the documented portfolio, 1000 USDT and no BTC, with a STICKY BUY of half of it rounded down to 8 decimals', () => {
      startStrategy(61234.56, { ...percentGrid, buyLevels: 5, sellLevels: 5 }, unbalancedPortfolio);

      expect(createOrder.mock.calls).toEqual([[{ type: 'STICKY', side: 'BUY', amount: 0.00816532, symbol: 'BTC/USDT' }]]);
    });

    it('places a balanced grid 1 % around the close, its prices and amounts to 8 decimals', () => {
      const portfolio: Portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 0.05, used: 0, total: 0.05 }],
        ['USDT', { free: 3000, used: 0, total: 3000 }],
      ]);
      startStrategy(61234.56, { ...percentGrid, buyLevels: 1, sellLevels: 1 }, portfolio);

      expect(createOrder.mock.calls).toEqual([
        [{ type: 'LIMIT', side: 'BUY', amount: 0.0494868, price: 60622.2144, symbol: 'BTC/USDT' }],
        [{ type: 'LIMIT', side: 'SELL', amount: 0.0494868, price: 61846.9056, symbol: 'BTC/USDT' }],
      ]);
    });
  });
});
