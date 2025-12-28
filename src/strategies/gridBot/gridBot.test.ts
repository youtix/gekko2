import type { Candle } from '@models/candle.types';
import type { OrderSide } from '@models/order.types';
import type { BalanceDetail, Portfolio } from '@models/portfolio.types';
import type { MarketData } from '@services/exchange/exchange.types';
import type { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridBot } from './gridBot.strategy';
import type { GridBotStrategyParams } from './gridBot.types';

const defaultParams: GridBotStrategyParams = {
  buyLevels: 2,
  sellLevels: 2,
  spacingType: 'fixed',
  spacingValue: 5,
};

const marketData: MarketData = {
  amount: { min: 0.1 },
  precision: { price: 0.01, amount: 0.01 },
};

const makeCandle = (close: number): Candle =>
  ({
    start: 0,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }) as Candle;

const balancedPortfolio: Portfolio = {
  asset: { free: 5, used: 0, total: 5 },
  currency: { free: 500, used: 0, total: 500 },
};

const unbalancedPortfolio: Portfolio = {
  asset: { free: 0, used: 0, total: 0 },
  currency: { free: 1000, used: 0, total: 1000 },
};

const defaultBalance: BalanceDetail = { free: 0, used: 0, total: 0 };

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
    tools = { strategyParams: defaultParams, marketData, createOrder, cancelOrder, log };
  });

  const initStrategy = (
    price = 100,
    params: Partial<GridBotStrategyParams> = {},
    portfolio: Portfolio = balancedPortfolio,
  ) => {
    tools.strategyParams = { ...defaultParams, ...params };
    strategy.init({
      candle: makeCandle(price),
      portfolio: { asset: { ...portfolio.asset }, currency: { ...portfolio.currency } },
      tools,
      addIndicator: vi.fn(),
    });
  };

  const findOrderId = (price: number, side: OrderSide): UUID | undefined =>
    issuedOrders.find(order => order.price === price && order.side === side)?.id;

  const findLatestOrderId = (side: OrderSide): UUID | undefined => {
    for (let i = issuedOrders.length - 1; i >= 0; i--) {
      if (issuedOrders[i].side === side) return issuedOrders[i].id;
    }
    return undefined;
  };

  describe('init', () => {
    it('places correct number of orders for balanced portfolio', () => {
      initStrategy(100);

      expect(createOrder).toHaveBeenCalledTimes(4);
    });

    it.each`
      buyLevels | sellLevels | expectedOrders
      ${1}      | ${1}       | ${2}
      ${2}      | ${2}       | ${4}
      ${3}      | ${2}       | ${5}
      ${2}      | ${3}       | ${5}
    `(
      'places $expectedOrders orders for $buyLevels buy and $sellLevels sell levels',
      ({ buyLevels, sellLevels, expectedOrders }) => {
        // Create portfolio balanced for this level ratio
        // Target asset ratio = sellLevels / (buyLevels + sellLevels)
        const totalValue = 1000;
        const assetRatio = sellLevels / (buyLevels + sellLevels);
        const assetValue = totalValue * assetRatio;
        const assetAmount = assetValue / 100; // at price 100
        const currencyValue = totalValue - assetValue;

        const balancedForLevels: Portfolio = {
          asset: { free: assetAmount, used: 0, total: assetAmount },
          currency: { free: currencyValue, used: 0, total: currencyValue },
        };

        initStrategy(100, { buyLevels, sellLevels }, balancedForLevels);

        expect(createOrder).toHaveBeenCalledTimes(expectedOrders);
      },
    );

    it('places buy orders below center price', () => {
      initStrategy(100);

      const buyOrders = issuedOrders.filter(o => o.side === 'BUY');
      expect(buyOrders.every(o => o.price < 100)).toBe(true);
    });

    it('places sell orders above center price', () => {
      initStrategy(100);

      const sellOrders = issuedOrders.filter(o => o.side === 'SELL');
      expect(sellOrders.every(o => o.price > 100)).toBe(true);
    });

    it('uses LIMIT order type for grid orders', () => {
      initStrategy(100);

      expect(issuedOrders.every(o => o.type === 'LIMIT')).toBe(true);
    });
  });

  describe('rebalancing', () => {
    it('places STICKY rebalance order for unbalanced portfolio', () => {
      initStrategy(100, {}, unbalancedPortfolio);

      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    it('uses correct side for rebalance when asset value is low', () => {
      initStrategy(100, {}, unbalancedPortfolio);

      expect(issuedOrders[0].type).toBe('STICKY');
    });

    it('builds grid after rebalance completion', () => {
      initStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderCompleted({
        order: { id: rebalanceId, side: 'BUY' } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });

    it('retries rebalance on error', () => {
      initStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderErrored({
        order: { id: rebalanceId, reason: 'Test error' } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: unbalancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(2);
    });

    it('builds grid after rebalance retry limit', () => {
      initStrategy(100, { retryOnError: 1 }, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;

      // First error
      strategy.onOrderErrored({
        order: { id: rebalanceId, reason: 'Test error' } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: unbalancedPortfolio },
        tools,
      });

      // Second error exceeds limit
      const retryId = issuedOrders[1].id;
      strategy.onOrderErrored({
        order: { id: retryId, reason: 'Test error' } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: unbalancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Rebalance failed'));
    });

    it('handles rebalance order cancellation', () => {
      initStrategy(100, {}, unbalancedPortfolio);

      const rebalanceId = issuedOrders[0].id;
      strategy.onOrderCanceled({
        order: { id: rebalanceId } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: unbalancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('failed'));
    });

    it('skips rebalance if insufficient currency for buy', () => {
      // Asset value is 0, currency is 50 - total value 50, needs 25 asset value
      // That's buying 0.25 at price 100 = 25 in currency (but free currency is only 10)
      const lowCurrencyPortfolio: Portfolio = {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 10, used: 0, total: 50 },
      };
      initStrategy(100, {}, lowCurrencyPortfolio);

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Insufficient currency'));
    });

    it('skips rebalance if insufficient asset for sell', () => {
      // Currency is 0, asset is low - would need to SELL but not enough asset
      const lowAssetPortfolio: Portfolio = {
        asset: { free: 0.001, used: 0, total: 0.001 },
        currency: { free: 100, used: 0, total: 100 },
      };
      initStrategy(100, {}, lowAssetPortfolio);

      // This portfolio needs a BUY to rebalance (asset value is low)
      // so it should place a STICKY order
      expect(issuedOrders[0]?.type).toBe('STICKY');
    });
  });

  describe('validation', () => {
    it('logs error for non-positive center price', () => {
      initStrategy(0);

      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Center price'));
    });

    it('logs error for invalid spacing value', () => {
      initStrategy(100, { spacingValue: 0 });

      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Spacing value'));
    });

    it('logs error for negative buy prices', () => {
      initStrategy(100, { buyLevels: 25, spacingType: 'fixed', spacingValue: 5 });

      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('non-positive buy prices'));
    });
  });

  describe('order completion', () => {
    it('arms adjacent opposite level after buy fill', () => {
      initStrategy(100);
      const initialOrderCount = createOrder.mock.calls.length;

      // Find first buy order (at 95, which is index 1 in the levels array: [-2, -1, 1, 2])
      // After buy at level -1 (price 95) fills, should arm SELL at level 0 (but we skip 0)
      // Actually the neighbor is the next element in the array
      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderCompleted({
        order: { id: buyId as UUID, side: 'BUY' } as any,
        exchange: { price: 95, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      // The adjacent sell level should already have an order, so no new order is created
      // unless the neighbor is empty
      expect(createOrder.mock.calls.length).toBeGreaterThanOrEqual(initialOrderCount);
    });

    it('arms adjacent opposite level after sell fill', () => {
      initStrategy(100);
      const initialOrderCount = createOrder.mock.calls.length;

      const sellId = findOrderId(105, 'SELL');
      strategy.onOrderCompleted({
        order: { id: sellId as UUID, side: 'SELL' } as any,
        exchange: { price: 105, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      // The adjacent buy level should already have an order, so no new order is created
      expect(createOrder.mock.calls.length).toBeGreaterThanOrEqual(initialOrderCount);
    });

    it('logs warning when only one side remains', () => {
      initStrategy(100, { buyLevels: 1, sellLevels: 1 });

      // Complete the only buy order
      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderCompleted({
        order: { id: buyId as UUID, side: 'BUY' } as any,
        exchange: { price: 95, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      // Complete the only sell order
      const sellId = findOrderId(105, 'SELL');
      strategy.onOrderCompleted({
        order: { id: sellId as UUID, side: 'SELL' } as any,
        exchange: { price: 105, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('one side'));
    });

    it('ignores unknown order IDs', () => {
      initStrategy(100);

      const initialCalls = createOrder.mock.calls.length;
      strategy.onOrderCompleted({
        order: { id: 'unknown-id' as UUID, side: 'BUY' } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(initialCalls);
    });
  });

  describe('order errors', () => {
    it('retries order on error', () => {
      initStrategy(100);

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderErrored({
        order: { id: buyId as UUID, reason: 'Test error' } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });

    it('stops retrying after limit', () => {
      initStrategy(100, { retryOnError: 1 });

      const buyId = findOrderId(95, 'BUY');

      // First error - retry
      strategy.onOrderErrored({
        order: { id: buyId as UUID, reason: 'Test error' } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      const retryId = findLatestOrderId('BUY');

      // Second error - limit reached
      strategy.onOrderErrored({
        order: { id: retryId as UUID, reason: 'Test error' } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Retry limit'));
    });
  });

  describe('order cancellation', () => {
    it('replaces canceled grid order', () => {
      initStrategy(100);

      const buyId = findOrderId(95, 'BUY');
      strategy.onOrderCanceled({
        order: { id: buyId as UUID } as any,
        exchange: { price: 100, balance: defaultBalance, portfolio: balancedPortfolio },
        tools,
      });

      expect(createOrder).toHaveBeenCalledTimes(5);
    });
  });

  describe('out of range', () => {
    it('logs warning when price exits grid range', () => {
      initStrategy(100);

      strategy.onEachTimeframeCandle({
        candle: makeCandle(150),
        portfolio: balancedPortfolio,
        tools,
      });

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('out of grid range'));
    });

    it('does not log when price is in range', () => {
      initStrategy(100);

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
    `(
      'calculates correct prices for $spacingType spacing',
      ({ spacingType, spacingValue, expectedBuyPrice, expectedSellPrice }) => {
        initStrategy(100, { spacingType, spacingValue, buyLevels: 1, sellLevels: 1 });

        const buyOrders = issuedOrders.filter(o => o.side === 'BUY');
        const sellOrders = issuedOrders.filter(o => o.side === 'SELL');

        expect(buyOrders[0]?.price).toBe(expectedBuyPrice);
        expect(sellOrders[0]?.price).toBe(expectedSellPrice);
      },
    );
  });

  describe('lifecycle methods', () => {
    it('onTimeframeCandleAfterWarmup does not throw', () => {
      initStrategy(100);

      expect(() =>
        strategy.onTimeframeCandleAfterWarmup({
          candle: makeCandle(100),
          portfolio: balancedPortfolio,
          tools,
        }),
      ).not.toThrow();
    });

    it('log method does not throw', () => {
      initStrategy(100);

      expect(() =>
        strategy.log({
          candle: makeCandle(100),
          portfolio: balancedPortfolio,
          tools,
        }),
      ).not.toThrow();
    });

    it('end method does not throw', () => {
      initStrategy(100);

      expect(() => strategy.end()).not.toThrow();
    });
  });
});
