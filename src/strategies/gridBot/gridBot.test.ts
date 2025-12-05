import type { Candle } from '@models/candle.types';
import type { OrderSide } from '@models/order.types';
import type { Portfolio } from '@models/portfolio.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridBot } from './gridBot.strategy';
import type { GridBotStrategyParams } from './gridBot.types';

const defaultParams: GridBotStrategyParams = {
  levelsPerSide: 2,
  spacingType: 'fixed',
  spacingValue: 5,
  levelQuantity: 0.5,
  mode: 'recenter',
};

const marketData = {
  amount: { min: 0.1 },
  price: { min: 0.01 },
  cost: { min: 1 },
  precision: { price: 0.01, amount: 0.1 },
};

const makeCandle = (price = 100): Candle =>
  ({
    start: 0,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }) as Candle;

const defaultPortfolio: Portfolio = { asset: 5, currency: 500 };

describe('GridBot', () => {
  let strategy: GridBot;
  let createOrder: ReturnType<typeof vi.fn>;
  let cancelOrder: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.fn>;
  let issuedOrders: Array<{ id: UUID; price: number; side: OrderSide }>;
  let tools: any;

  beforeEach(() => {
    strategy = new GridBot();
    issuedOrders = [];
    log = vi.fn();
    cancelOrder = vi.fn();
    createOrder = vi.fn(order => {
      const id = `order-${issuedOrders.length + 1}` as UUID;
      issuedOrders.push({ id, price: order.price ?? 0, side: order.side });
      return id;
    });
    tools = { strategyParams: defaultParams, marketData, createOrder, cancelOrder, log };
  });

  const initStrategy = (price = 100, params: Partial<GridBotStrategyParams> = {}) => {
    tools.strategyParams = { ...defaultParams, ...params };
    strategy.init({
      candle: makeCandle(price),
      portfolio: { ...defaultPortfolio },
      tools,
      addIndicator: vi.fn(),
    });
  };

  const findOrderId = (price: number, side: OrderSide): UUID | undefined =>
    issuedOrders.find(order => order.price === price && order.side === side)?.id;

  const findLatestOrderId = (price: number, side: OrderSide): UUID | undefined => {
    for (let i = issuedOrders.length - 1; i >= 0; i--) {
      const order = issuedOrders[i];
      if (order.price === price && order.side === side) return order.id;
    }
    return undefined;
  };

  describe('Initialization', () => {
    it.each([
      { levels: 1, expectedPrices: [95, 105] },
      { levels: 2, expectedPrices: [90, 95, 105, 110] },
    ])('places correct orders for $levels levels per side', ({ levels, expectedPrices }) => {
      initStrategy(100, { levelsPerSide: levels });

      expect(createOrder).toHaveBeenCalledTimes(levels * 2);
      const prices = createOrder.mock.calls.map(([order]) => order.price).sort((a, b) => a - b);
      expect(prices).toEqual(expectedPrices);
    });

    it.each([
      { price: 0, desc: 'non-positive price' },
      { price: -10, desc: 'negative price' },
    ])('logs error and does not place orders for $desc', ({ price }) => {
      initStrategy(price);
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('non-positive center price'));
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('logs error for invalid spacing', () => {
      initStrategy(100, { spacingValue: 0 });
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('spacingValue must be greater than zero'));
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('logs warn if order cap reduces levels', () => {
      initStrategy(100, { totalOpenOrderCap: 1 }); // Cap 1 -> perSide 0
      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('reduced levelsPerSide'));
      // It still places orders (1 level)
      expect(createOrder).toHaveBeenCalled();
    });

    it('logs error if portfolio insufficient for single level', () => {
      tools.strategyParams = defaultParams;
      strategy.init({
        candle: makeCandle(100),
        portfolio: { asset: 0, currency: 0 }, // No funds
        tools,
        addIndicator: vi.fn(),
      });
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('portfolio is insufficient'));
      expect(createOrder).not.toHaveBeenCalled();
    });
  });

  describe('Order Execution', () => {
    it('creates follow-up orders one level away after fills', () => {
      initStrategy();

      const buyId = findOrderId(95, 'BUY');
      expect(buyId).toBeDefined();

      // Fill BUY at 95
      strategy.onOrderCompleted({
        tools,
        order: {
          id: buyId as UUID,
          side: 'BUY',
          type: 'LIMIT',
          amount: 0.5,
          price: 95,
          orderExecutionDate: Date.now(),
          fee: 0,
          effectivePrice: 95,
        } as any,
        exchange: { price: 95, balance: 0, portfolio: { ...defaultPortfolio } },
      });

      // Expect SELL at 100 (one level up from 95)
      expect(createOrder).toHaveBeenCalledTimes(5);
      expect(createOrder.mock.calls.at(-1)?.[0]).toMatchObject({ side: 'SELL', price: 100, amount: 0.5 });

      const sellId = findLatestOrderId(100, 'SELL');
      expect(sellId).toBeDefined();

      // Fill SELL at 100
      strategy.onOrderCompleted({
        tools,
        order: {
          id: sellId as UUID,
          side: 'SELL',
          type: 'LIMIT',
          amount: 0.5,
          price: 100,
          orderExecutionDate: Date.now(),
          fee: 0,
          effectivePrice: 100,
        } as any,
        exchange: { price: 100, balance: 0, portfolio: { ...defaultPortfolio } },
      });

      // Expect BUY at 95 (one level down from 100)
      expect(createOrder).toHaveBeenCalledTimes(6);
      expect(createOrder.mock.calls.at(-1)?.[0]).toMatchObject({ side: 'BUY', price: 95, amount: 0.5 });
    });
  });

  describe('Error Handling', () => {
    it('retries order creation on error up to retry limit', () => {
      initStrategy();
      const buyId = findOrderId(95, 'BUY');
      expect(buyId).toBeDefined();

      // Simulate fill to trigger new order creation
      strategy.onOrderCompleted({
        tools,
        order: { id: buyId as UUID, side: 'BUY', price: 95 } as any,
        exchange: { price: 95, balance: 0, portfolio: { ...defaultPortfolio } },
      });

      // Expect SELL at 100.
      const sellId = findLatestOrderId(100, 'SELL');
      expect(sellId).toBeDefined();

      const orderId = findOrderId(105, 'SELL') as UUID;
      expect(orderId).toBeDefined();

      // Simulate error
      strategy.onOrderErrored({
        tools,
        order: { id: orderId, reason: 'Test error' } as any,
        exchange: { price: 100, balance: 0, portfolio: defaultPortfolio },
      });

      // Should retry creation
      expect(createOrder).toHaveBeenCalledTimes(6); // 4 init + 1 fill + 1 retry
      expect(log).not.toHaveBeenCalledWith('error', expect.anything());

      // Fail again (retry 1)
      const retryId1 = createOrder.mock.results[5].value;
      strategy.onOrderErrored({
        tools,
        order: { id: retryId1, reason: 'Test error' } as any,
        exchange: { price: 100, balance: 0, portfolio: defaultPortfolio },
      });
      expect(createOrder).toHaveBeenCalledTimes(7);

      // Fail again (retry 2)
      const retryId2 = createOrder.mock.results[6].value;
      strategy.onOrderErrored({
        tools,
        order: { id: retryId2, reason: 'Test error' } as any,
        exchange: { price: 100, balance: 0, portfolio: defaultPortfolio },
      });
      expect(createOrder).toHaveBeenCalledTimes(8);

      // Fail again (retry 3 - limit reached?) Default limit is 3.
      // attempts: 1 (first error), 2, 3.
      // If limit is 3, 4th attempt should fail.

      const retryId3 = createOrder.mock.results[7].value;
      strategy.onOrderErrored({
        tools,
        order: { id: retryId3, reason: 'Test error' } as any,
        exchange: { price: 100, balance: 0, portfolio: defaultPortfolio },
      });
      expect(createOrder).toHaveBeenCalledTimes(8);

      // Should NOT retry again, should log error
      expect(createOrder).toHaveBeenCalledTimes(8);
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('retry limit reached'));
    });
  });

  describe('Rebalancing', () => {
    it('rebalances when drift exceeds tolerance', () => {
      // Drift 50% (0 asset, 100 currency). Tolerance 1%.
      tools.strategyParams = {
        ...defaultParams,
        levelQuantity: undefined,
        rebalance: { enabled: true, tolerancePercent: 1 },
      };

      strategy.init({
        candle: makeCandle(100),
        portfolio: { asset: 0, currency: 100 },
        tools,
        addIndicator: vi.fn(),
      });

      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0]?.[0]).toMatchObject({ type: 'STICKY', side: 'BUY', amount: 0.5 });
    });

    it('skips rebalance when drift is within tolerance', () => {
      // Drift 0%. Tolerance 5%.
      tools.strategyParams = {
        ...defaultParams,
        levelQuantity: undefined,
        rebalance: { enabled: true, tolerancePercent: 5 },
      };

      strategy.init({
        candle: makeCandle(100),
        portfolio: { asset: 0.5, currency: 50 }, // Balanced at price 100
        tools,
        addIndicator: vi.fn(),
      });

      expect(createOrder).toHaveBeenCalledTimes(4); // 4 limit orders
      const orders = createOrder.mock.calls.map(([order]) => order);
      expect(orders.every(order => order.type === 'LIMIT')).toBe(true);
    });

    it('retries rebalance order on error', () => {
      tools.strategyParams = {
        ...defaultParams,
        rebalance: { enabled: true, tolerancePercent: 1 },
      };
      strategy.init({
        candle: makeCandle(100),
        portfolio: { asset: 0, currency: 100 },
        tools,
        addIndicator: vi.fn(),
      });

      expect(createOrder).toHaveBeenCalledTimes(1);
      const rebalanceId = issuedOrders[0]?.id as UUID;

      // Simulate error
      strategy.onOrderErrored({
        tools,
        order: { id: rebalanceId, reason: 'Test error' } as any,
        exchange: { price: 100, balance: 0, portfolio: { asset: 0, currency: 100 } },
      });

      expect(createOrder).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('GridBot rebalance attempt 1 failed'));
    });
  });

  describe('Recentering', () => {
    it('triggers recenter when price exits grid range', () => {
      initStrategy(100); // Range [90, 110]

      // Move price to 120 (outside)
      strategy.onEachTimeframeCandle({
        candle: makeCandle(120),
        portfolio: defaultPortfolio,
        tools,
      });

      expect(log).toHaveBeenCalledWith('info', expect.stringContaining('GridBot recenter triggered'));
      expect(cancelOrder).toHaveBeenCalledTimes(4); // Cancel all 4 orders
    });

    it('finishes recenter and rebuilds grid after all cancels', () => {
      initStrategy(100);

      // Trigger recenter
      strategy.onEachTimeframeCandle({
        candle: makeCandle(120),
        portfolio: defaultPortfolio,
        tools,
      });

      expect(cancelOrder).toHaveBeenCalledTimes(4);
      const cancelIds = issuedOrders.map(o => o.id);

      // Confirm 3 cancels
      for (let i = 0; i < 3; i++) {
        strategy.onOrderCanceled({
          tools,
          order: { id: cancelIds[i] } as any,
          exchange: { price: 120, balance: 0, portfolio: defaultPortfolio },
        });
      }

      // Grid not rebuilt yet
      expect(createOrder).toHaveBeenCalledTimes(4); // Initial 4

      // Confirm last cancel
      strategy.onOrderCanceled({
        tools,
        order: { id: cancelIds[3] } as any,
        exchange: { price: 120, balance: 0, portfolio: defaultPortfolio },
      });

      // Grid rebuilt around 120
      expect(createOrder).toHaveBeenCalledTimes(8); // 4 initial + 4 new
      const newOrders = createOrder.mock.calls.slice(4).map(([order]) => order);
      // Center 120. Levels 2. Spacing 5.
      // Prices: 110, 115, 125, 130.
      const prices = newOrders.map(o => o.price).sort((a, b) => a - b);
      expect(prices).toEqual([110, 115, 125, 130]);
    });
  });
});
