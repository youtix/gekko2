import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INITIATED_EVENT,
  ORDER_INVALID_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
  PORTFOLIO_CHANGE_EVENT,
} from '@constants/event.const';
import { AdviceOrder } from '@models/advice.types';
import { BalanceDetail } from '@models/portfolio.types';
import { OrderSummary } from '@services/core/order/order.types';
import * as lodash from 'lodash-es';
import type { Mock } from 'vitest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../services/configuration/configuration';
import * as logger from '../../services/logger';
import * as processUtils from '../../utils/process/process.utils';
import { Trader } from './trader';

vi.mock('@services/logger');

const baseWatch = {
  pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }],
  tickrate: 1000,
  mode: 'realtime' as const,
  fillGaps: 'empty' as const,
  warmup: { tickrate: 1000, candleCount: 0 },
  daterange: null,
};

const cloneWatch = () => ({
  ...baseWatch,
  pairs: [...baseWatch.pairs],
  warmup: { ...baseWatch.warmup },
});

type OrderListener = (...args: unknown[]) => void;

vi.mock('lodash-es', async () => ({
  ...(await vi.importActual('lodash-es')),
  bindAll: vi.fn(),
}));

vi.mock('../../services/configuration/configuration', () => {
  const getWatch = vi.fn(() => cloneWatch());
  const getStrategy = vi.fn(() => ({}));
  const getExchange = vi.fn(() => ({ name: 'dummy-cex' }));
  return { config: { getWatch, getStrategy, getExchange } };
});

const tick = async (count = 3) => {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
};

function createOrderMock(type: 'STICKY' | 'MARKET' | 'LIMIT', requiresPrice = false) {
  const listenersStore = new WeakMap<object, Map<string, Set<OrderListener>>>();

  const ensureStore = (instance: object) => {
    let store = listenersStore.get(instance);
    if (!store) {
      store = new Map();
      listenersStore.set(instance, store);
    }
    return store;
  };

  const addListener = (instance: object, event: string, handler: OrderListener) => {
    const store = ensureStore(instance);
    let handlers = store.get(event);
    if (!handlers) {
      handlers = new Set();
      store.set(event, handlers);
    }
    handlers.add(handler);
  };

  const removeListener = (instance: object, event: string, handler: OrderListener) => {
    const store = ensureStore(instance);
    const handlers = store.get(event);
    if (!handlers) return;
    handlers.delete(handler);
    if (!handlers.size) store.delete(event);
  };

  function MockOrder(
    this: any,
    symbol: string,
    id: string,
    side: string,
    amount: number,
    priceOrExchange: unknown,
    maybeExchange?: unknown,
  ) {
    ensureStore(this);
    this.symbol = symbol;
    this.id = id;
    this.side = side;
    this.amount = amount;
    this.price = requiresPrice ? priceOrExchange : undefined;
    this.exchange = requiresPrice ? maybeExchange : priceOrExchange;
    this.cancel = vi.fn();
    this.launch = vi.fn();
    this.createSummary = vi.fn().mockImplementation(async () => ({
      amount: this.amount,
      price: 100,
      feePercent: 0.25,
      side: this.side,
      orderExecutionDate: 1_700_000_111_000,
    }));
    this.removeAllListeners = vi.fn(() => {
      listenersStore.set(this, new Map());
    });
  }

  MockOrder.prototype.getGekkoOrderId = function () {
    return this.id;
  };

  MockOrder.prototype.getType = function () {
    return type;
  };

  MockOrder.prototype.getSide = function () {
    return this.side;
  };

  MockOrder.prototype.on = function (event: string, handler: OrderListener) {
    addListener(this, event, handler);
    return this;
  };

  MockOrder.prototype.once = function (event: string, handler: OrderListener) {
    const wrapped: OrderListener = (...args) => {
      removeListener(this, event, wrapped);
      handler(...args);
    };
    addListener(this, event, wrapped);
    return this;
  };

  MockOrder.prototype.emit = function (event: string, ...args: unknown[]) {
    const handlers = ensureStore(this).get(event);
    if (!handlers) return false;
    Array.from(handlers).forEach(listener => listener(...args));
    return handlers.size > 0;
  };

  return MockOrder as unknown as new (symbol: string, id: string, side: string, amount: number, exchange: unknown) => any;
}

vi.mock('../../services/core/order/sticky/stickyOrder', () => ({
  StickyOrder: createOrderMock('STICKY'),
}));

vi.mock('../../services/core/order/market/marketOrder', () => ({
  MarketOrder: createOrderMock('MARKET'),
}));

vi.mock('../../services/core/order/limit/limitOrder', () => ({
  LimitOrder: createOrderMock('LIMIT', true),
}));

describe('Trader', () => {
  const defaultCandle = { close: 100, start: 1_700_000_000_000 } as any;
  let trader: Trader;
  let fakeExchange: {
    getExchangeName: Mock;
    getIntervals: Mock;
    fetchTicker: Mock;
    fetchTickers: Mock;
    fetchBalance: Mock;
    getMarketLimits: Mock;
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let waitSpy: ReturnType<typeof vi.spyOn>;
  const getWatchMock = config.getWatch as unknown as Mock;
  const getExchangeMock = config.getExchange as unknown as Mock;
  const getStrategyMock = config.getStrategy as unknown as Mock;

  const getOrdersMap = () => (trader as any).orders;
  const getOrderMetadata = (id: string) => getOrdersMap().get(id);
  const getOrderInstance = (id: string) => getOrderMetadata(id)?.orderInstance;

  const buildAdvice = (overrides?: Partial<AdviceOrder>): AdviceOrder => ({
    id: overrides?.id ?? '20a7abd2-546b-4c65-b04d-900b84fa5fe6',
    orderCreationDate: overrides?.orderCreationDate ?? 1_700_000_000_100,
    type: overrides?.type ?? 'STICKY',
    side: overrides?.side ?? 'BUY',
    amount: overrides?.amount,
    price: overrides?.price,
    symbol: overrides?.symbol ?? 'BTC/USDT',
  });

  beforeAll(() => {
    vi.useFakeTimers();
    setIntervalSpy = vi.spyOn(global, 'setInterval');
    waitSpy = vi.spyOn(processUtils, 'wait');
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    waitSpy.mockResolvedValue(undefined);
    getWatchMock.mockReturnValue(cloneWatch());
    getExchangeMock.mockReturnValue({ name: 'dummy-cex' });
    getStrategyMock.mockReturnValue({});

    trader = new Trader();
    // Default currentTimestamp to something valid so dates in events are not 0
    trader['currentTimestamp'] = 1_700_000_000_000;

    fakeExchange = {
      getExchangeName: vi.fn(() => 'MockExchange'),
      getIntervals: vi.fn(() => ({ exchangeSync: 1, orderSync: 1 })),
      fetchTicker: vi.fn().mockResolvedValue({ bid: 123 }),
      fetchTickers: vi.fn().mockResolvedValue({ 'BTC/USDT': { bid: 123 } }),
      fetchBalance: vi.fn().mockResolvedValue(
        new Map<string, BalanceDetail>([
          ['BTC', { free: 1, used: 0, total: 1 }],
          ['USDT', { free: 2, used: 0, total: 2 }],
        ]),
      ),
      getMarketLimits: vi.fn(() => undefined),
    };

    trader['getExchange'] = vi.fn().mockReturnValue(fakeExchange);
    trader['addDeferredEmit'] = vi.fn();
  });

  afterEach(() => {
    trader?.['processFinalize']?.();
  });

  describe('constructor', () => {
    it.each`
      field                | expected
      ${'warmupCompleted'} | ${false}
      ${'warmupBucket'}    | ${expect.any(Map)}
      ${'prices'}          | ${expect.any(Map)}
    `('initializes $field to $expected', ({ field, expected }) => {
      expect((trader as any)[field]).toEqual(expected);
    });

    it('initializes portfolio as an empty Map', () => {
      const portfolio = (trader as any).portfolio;
      expect(portfolio).toBeInstanceOf(Map);
      expect(portfolio.size).toBe(0);
    });

    it('initializes orders collection as empty map', () => {
      const orders = getOrdersMap();
      expect(orders).toBeInstanceOf(Map);
      expect(orders.size).toBe(0);
    });

    it('binds synchronize function', () => {
      const bindAllMock = lodash.bindAll as unknown as Mock;
      expect(bindAllMock).toHaveBeenCalledWith(trader, ['synchronize']);
    });
  });

  describe('synchronize', () => {
    describe('Default Mode (No Portfolio Updates Config)', () => {
      it('should fetch portfolio and tickers from exchange', async () => {
        await trader['synchronize']();
        expect(fakeExchange.fetchBalance).toHaveBeenCalledTimes(1);
        expect(fakeExchange.fetchTickers).toHaveBeenCalledTimes(1);
      });

      it('should update trader plugin portfolio and prices', async () => {
        const newBalance = new Map<string, BalanceDetail>([
          ['BTC', { free: 3, used: 0, total: 3 }],
          ['USDT', { free: 50, used: 0, total: 50 }],
        ]);
        fakeExchange.fetchBalance.mockResolvedValue(newBalance);
        fakeExchange.fetchTickers.mockResolvedValue({ 'BTC/USDT': { bid: 200 } });

        await trader['synchronize']();

        expect(trader['portfolio']).toEqual(newBalance);
        expect(trader['prices'].get('BTC/USDT')).toBe(200);
      });

      it('should always emit portfolio change event', async () => {
        // Even if portfolio is empty or unchanged
        const spy = vi.spyOn(trader as any, 'emitPortfolioChangeEvent');
        await trader['synchronize']();
        expect(spy).toHaveBeenCalledOnce();
      });
    });

    describe('With Portfolio Updates Config', () => {
      let filteredTrader: Trader;

      beforeEach(() => {
        getWatchMock.mockReturnValue(cloneWatch());
        // threshold 1%, dust 1
        filteredTrader = new Trader({ portfolioUpdates: { threshold: 1, dust: 1 } });
        filteredTrader['currentTimestamp'] = 1_700_000_000_000;
        filteredTrader['getExchange'] = vi.fn().mockReturnValue(fakeExchange);
        filteredTrader['addDeferredEmit'] = vi.fn();
        filteredTrader['prices'].set('BTC/USDT', 100);
      });

      it.each`
        description                                                   | oldPortfolio                                                                                                                 | newPortfolio                                                                                                                         | expectedEmit
        ${'should emit when first sync (lastEmitted is null)'}        | ${null}                                                                                                                      | ${new Map([['BTC', { total: 2 }]])}                                                                                                  | ${true}
        ${'should NOT emit when change is below threshold'}           | ${new Map<string, BalanceDetail>([['BTC', { free: 1, used: 0, total: 1 }], ['USDT', { free: 1000, used: 0, total: 1000 }]])} | ${new Map<string, BalanceDetail>([['BTC', { free: 1.005, used: 0, total: 1.005 }], ['USDT', { free: 1000, used: 0, total: 1000 }]])} | ${false}
        ${'should emit when change is above threshold'}               | ${new Map<string, BalanceDetail>([['BTC', { free: 1, used: 0, total: 1 }], ['USDT', { free: 1000, used: 0, total: 1000 }]])} | ${new Map<string, BalanceDetail>([['BTC', { free: 1.05, used: 0, total: 1.05 }], ['USDT', { free: 1000, used: 0, total: 1000 }]])}   | ${true}
        ${'should emit when portfolio structure changes (new asset)'} | ${new Map<string, BalanceDetail>([['USDT', { free: 1000, used: 0, total: 1000 }]])}                                          | ${new Map<string, BalanceDetail>([['BTC', { free: 0.1, used: 0, total: 0.1 }], ['USDT', { free: 1000, used: 0, total: 1000 }]])}     | ${true}
      `('$description', async ({ oldPortfolio, newPortfolio, expectedEmit }) => {
        // Setup initial state
        filteredTrader['lastEmittedPortfolio'] = oldPortfolio;
        filteredTrader['portfolio'] = oldPortfolio || new Map(); // just to have something before sync overrides it

        // Mock exchange to return new portfolio
        fakeExchange.fetchBalance.mockResolvedValue(newPortfolio);

        // Mock Emit
        const emitSpy = vi.spyOn(filteredTrader as any, 'emitPortfolioChangeEvent');

        await filteredTrader['synchronize']();

        if (expectedEmit) {
          expect(emitSpy).toHaveBeenCalledOnce();
          // Also verify lastEmittedPortfolio is updated to newPortfolio
          expect(filteredTrader['lastEmittedPortfolio']).toEqual(newPortfolio);
        } else {
          expect(emitSpy).not.toHaveBeenCalled();
          // Verify lastEmittedPortfolio remains unchanged
          expect(filteredTrader['lastEmittedPortfolio']).toEqual(oldPortfolio);
        }
      });
    });
  });

  describe('emitPortfolioChangeEvent', () => {
    it('defers portfolio change event with current portfolio', () => {
      const portfolio = new Map<string, BalanceDetail>([
        ['BTC', { free: 10, used: 0, total: 10 }],
        ['USDT', { free: 25, used: 0, total: 25 }],
      ]);
      trader['portfolio'] = portfolio;

      trader['emitPortfolioChangeEvent']();

      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(PORTFOLIO_CHANGE_EVENT, portfolio);
    });
  });

  describe('onStrategyWarmupCompleted', () => {
    it('should set warmupCompleted to true', async () => {
      trader['warmupCompleted'] = false;
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;
      trader['warmupBucket'] = bucket;
      trader['processOneMinuteBucket'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted(new Map() as any);

      expect(trader['warmupCompleted']).toBeTruthy();
    });

    it('should clear warmupBucket', async () => {
      trader['warmupCompleted'] = false;
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;
      trader['warmupBucket'] = bucket;
      trader['processOneMinuteBucket'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted(new Map() as any);

      expect(trader['warmupBucket']).not.toBe(bucket);
      expect(trader['warmupBucket']?.size).toBe(0);
    });

    it('should call processOneMinuteBucket when collected bucket has all pairs', async () => {
      // pairs length is 1 by default mock
      trader['warmupCompleted'] = false;
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;
      trader['warmupBucket'] = bucket;
      trader['processOneMinuteBucket'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted(new Map() as any);

      expect(trader['processOneMinuteBucket']).toHaveBeenCalledWith(bucket);
    });

    it('should throw error if warmup buckets are incomplete (not all pairs present)', async () => {
      trader['warmupBucket'] = new Map() as any; // Empty map, but 1 pair expected
      trader['processOneMinuteBucket'] = vi.fn();

      await expect(trader.onStrategyWarmupCompleted(new Map() as any)).rejects.toThrow(/Impossible to process warmup bucket/);
    });

    it('should synchronize with exchange', async () => {
      trader['warmupBucket'] = new Map([['BTC/USDT', defaultCandle]]) as any;
      trader['processOneMinuteBucket'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted(new Map() as any);

      expect(trader['synchronize']).toHaveBeenCalledOnce();
    });
  });

  describe('processOneMinuteBucket', () => {
    it('should update price for all symbols in bucket', async () => {
      trader['prices'].set('BTC/USDT', 0);
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;

      await trader['processOneMinuteBucket'](bucket);

      expect(trader['prices'].get('BTC/USDT')).toBe(100);
    });

    it('should NOT trigger synchronize in realtime mode even if interval matches', async () => {
      (trader as any).mode = 'realtime';
      trader['synchronize'] = vi.fn();
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;

      await trader['processOneMinuteBucket'](bucket);

      expect(trader['synchronize']).not.toHaveBeenCalled();
    });

    it('should update currentTimestamp', async () => {
      trader['currentTimestamp'] = 0;
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;

      await trader['processOneMinuteBucket'](bucket);

      expect(trader['currentTimestamp']).toBe(1_700_000_060_000); // start + 1 min
    });

    it('should buffer candle until warmup completes', async () => {
      trader['warmupCompleted'] = false;
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;
      // Note: processOneMinuteBucket REPLACES warmupBucket reference if not completed

      await trader['processOneMinuteBucket'](bucket);

      expect(trader['warmupBucket']).toBe(bucket);
    });

    it('should NOT update warmupBucket once warmup completes', async () => {
      trader['warmupCompleted'] = true;
      const initialBucket = new Map() as any;
      trader['warmupBucket'] = initialBucket;
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;

      await trader['processOneMinuteBucket'](bucket);

      expect(trader['warmupBucket']).toBe(initialBucket);
    });
  });

  describe('onStrategyCreateOrder', () => {
    const getInitiatedEvent = () => {
      const emitCalls = (trader['addDeferredEmit'] as unknown as Mock).mock.calls;
      return emitCalls.find(call => call[0] === ORDER_INITIATED_EVENT)?.[1];
    };
    const getInitiatedOrder = () => getInitiatedEvent()?.order;

    beforeEach(() => {
      trader['prices'].set('BTC/USDT', 100);
      trader['portfolio'] = new Map<string, BalanceDetail>([
        ['BTC', { free: 3, used: 0, total: 3 }],
        ['USDT', { free: 1000, used: 0, total: 1000 }],
      ]);
    });

    it('creates order in internal map', async () => {
      const advice = buildAdvice();
      await trader.onStrategyCreateOrder([advice]);
      expect(getOrdersMap().size).toBe(1);
    });

    it.each`
      field       | expected
      ${'id'}     | ${'20a7abd2-546b-4c65-b04d-900b84fa5fe6'}
      ${'type'}   | ${'STICKY'}
      ${'side'}   | ${'BUY'}
      ${'amount'} | ${9.5}
    `('emits initiated event with correct $field', async ({ field, expected }) => {
      const advice = buildAdvice();
      await trader.onStrategyCreateOrder([advice]);
      const initiated = getInitiatedOrder();

      if (typeof expected === 'number') {
        expect(initiated?.[field]).toBeCloseTo(expected);
      } else {
        expect(initiated?.[field]).toBe(expected);
      }
    });

    it.each`
      side      | currencyFree | assetFree | price  | expectedAmount | desc
      ${'BUY'}  | ${1000}      | ${0}      | ${100} | ${9.5}         | ${'BUY uses currency / price * (1 - fee)'}
      ${'SELL'} | ${0}         | ${2.5}    | ${100} | ${2.5}         | ${'SELL uses full asset free balance'}
    `('computes correct amount for $desc', async ({ side, currencyFree, assetFree, price, expectedAmount }) => {
      trader['portfolio'] = new Map<string, BalanceDetail>([
        ['BTC', { free: assetFree, used: 0, total: assetFree }],
        ['USDT', { free: currencyFree, used: 0, total: currencyFree }],
      ]);
      trader['prices'].set('BTC/USDT', price);
      const advice = buildAdvice({ side, type: 'MARKET' });

      await trader.onStrategyCreateOrder([advice]);

      const initiated = getInitiatedOrder();
      expect(initiated?.amount).toBeCloseTo(expectedAmount, 5);
    });

    it('uses provided quantity when present in advice', async () => {
      const advice = buildAdvice({ amount: 1.2345, type: 'MARKET', side: 'BUY' });

      await trader.onStrategyCreateOrder([advice]);

      const initiated = getInitiatedOrder();
      expect(initiated?.amount).toBeCloseTo(1.2345, 5);

      const metadata = getOrderMetadata(advice.id);
      expect(metadata?.amount).toBeCloseTo(1.2345, 5);
    });

    it('creates limit order with requested price', async () => {
      const advice = buildAdvice({ type: 'LIMIT', side: 'BUY', price: 95 });

      await trader.onStrategyCreateOrder([advice]);

      const initiated = getInitiatedOrder();
      expect(initiated?.price).toBe(95);

      const metadata = getOrderMetadata(advice.id);
      expect(metadata?.price).toBe(95);
    });

    it('rejects order when symbol price is missing and no price provided', async () => {
      trader['prices'].clear();
      const advice = buildAdvice({ amount: 1, type: 'MARKET', side: 'SELL' });

      await trader.onStrategyCreateOrder([advice]);

      expect(logger.warning).toHaveBeenCalledWith('trader', expect.stringContaining('No price found'));
      const metadata = getOrderMetadata(advice.id);
      expect(metadata).toBeUndefined();
    });

    it('handles ORDER_ERRORED_EVENT from order instance', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
      (logger.error as Mock).mockClear();

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_ERRORED_EVENT, 'boom');
      await tick(); // Wait for async callbacks

      expect(logger.error).toHaveBeenCalledWith('trader', expect.stringContaining('boom'));
      expect(getOrdersMap().size).toBe(0);
      expect(synchronizeSpy).toHaveBeenCalled();

      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({ id: advice.id, reason: 'boom' }),
          exchange: { price: 100, portfolio: trader['portfolio'] },
        }),
      );
    });

    it('handles ORDER_INVALID_EVENT from order instance', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_INVALID_EVENT, { reason: 'limit too low', status: 'INVALID', filled: 0 });
      await tick();

      expect(logger.info).toHaveBeenCalledWith('trader', expect.stringContaining('limit too low'));
      expect(getOrdersMap().size).toBe(0);
      expect(synchronizeSpy).toHaveBeenCalled();

      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({ id: advice.id, reason: 'limit too low' }),
        }),
      );
    });

    it('delegates ORDER_COMPLETED_EVENT to completion handler', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
      const completionSpy = vi.spyOn(trader as any, 'emitOrderCompletedEvent');

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_COMPLETED_EVENT);
      await tick(); // Extra tick for async summary creation

      expect(order.createSummary).toHaveBeenCalled();
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(completionSpy).toHaveBeenCalledWith(advice.id, expect.objectContaining({ side: advice.side }));
      expect(getOrdersMap().size).toBe(0);
    });

    it('logs error if summary creation fails on completion', async () => {
      const advice = buildAdvice();
      (logger.error as Mock).mockClear();
      vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
      const completionSpy = vi.spyOn(trader as any, 'emitOrderCompletedEvent');

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;
      (order.createSummary as Mock).mockRejectedValue(new Error('summary failed'));

      order.emit(ORDER_COMPLETED_EVENT);
      await tick();

      expect(logger.error).toHaveBeenCalledWith('trader', expect.stringContaining('summary failed'));
      expect(completionSpy).not.toHaveBeenCalled();
      expect(getOrdersMap().size).toBe(0);
    });

    it('logs order updates (partially filled)', async () => {
      const advice = buildAdvice();
      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_PARTIALLY_FILLED_EVENT, 5.0);

      expect(logger.info).toHaveBeenCalledWith('trader', expect.stringContaining('total filled: 5'));
    });

    it('logs order updates (status changed)', async () => {
      const advice = buildAdvice();
      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_STATUS_CHANGED_EVENT, { status: 'OPEN', reason: 'Placed' });

      expect(logger.info).toHaveBeenCalledWith('trader', expect.stringContaining('Status changed: OPEN'));
    });
  });

  describe('onStrategyCancelOrder', () => {
    it('warns when order is unknown', async () => {
      await trader.onStrategyCancelOrder(['missing-id' as any]);
      expect(logger.warning).toHaveBeenCalledWith('trader', '[missing-id] Impossible to cancel order: Unknown Order');
    });

    it('cancels regular order and handles cancellation success', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
      trader['prices'].set('BTC/USDT', 100);

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      await trader.onStrategyCancelOrder([advice.id]);

      expect(order.removeAllListeners).toHaveBeenCalled();
      expect(order.cancel).toHaveBeenCalled();

      // Simulate successful cancel
      order.emit(ORDER_CANCELED_EVENT, { timestamp: 123456, filled: 2, remaining: 7.5 });
      await tick();

      expect(getOrdersMap().size).toBe(0);
      expect(synchronizeSpy).toHaveBeenCalled();

      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_CANCELED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({
            id: advice.id,
            filled: 2,
            remaining: 7.5,
          }),
          exchange: { price: 100, portfolio: trader['portfolio'] },
        }),
      );
    });

    it('includes requested price when canceling limit orders', async () => {
      const advice = buildAdvice({ type: 'LIMIT', side: 'SELL', price: 210 });
      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      await trader.onStrategyCancelOrder([advice.id]);

      order.emit(ORDER_CANCELED_EVENT, { filled: 0, remaining: 5 });
      await tick();

      const call = (trader['addDeferredEmit'] as Mock).mock.calls.find(c => c[0] === ORDER_CANCELED_EVENT);
      expect(call).toBeDefined();
      expect(call![1].order.price).toBe(210);
    });

    it('handles cancellation error', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
      trader['prices'].set('BTC/USDT', 100);

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      await trader.onStrategyCancelOrder([advice.id]);

      order.emit(ORDER_ERRORED_EVENT, 'exchange timeout');
      await tick();

      expect(getOrdersMap().size).toBe(0);
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({ id: advice.id, reason: 'exchange timeout', orderErrorDate: expect.any(Number) }),
        }),
      );
    });

    it('handles completion during cancellation', async () => {
      const advice = buildAdvice();
      const completionSpy = vi.spyOn(trader as any, 'emitOrderCompletedEvent');
      trader['prices'].set('BTC/USDT', 100);

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      await trader.onStrategyCancelOrder([advice.id]);

      // Simulate completed instead of canceled
      order.emit(ORDER_COMPLETED_EVENT);
      await tick();

      expect(completionSpy).toHaveBeenCalled();
      expect(getOrdersMap().size).toBe(0);
    });
  });

  describe('emitOrderCompletedEvent', () => {
    it('throws error when order metadata is missing', () => {
      expect(() => trader['emitOrderCompletedEvent']('unknown-id' as any, {} as any)).toThrow(/No order metadata found/);
    });

    it('emits completion summary with computed pricing', async () => {
      const summary: OrderSummary = {
        amount: 2,
        price: 100,
        feePercent: 0.5,
        side: 'BUY',
        orderExecutionDate: 1_700_000_111_000,
      };

      const advice = buildAdvice({ amount: 2 });
      // We need to inject order metadata into map
      getOrdersMap().set(advice.id, {
        amount: 2,
        side: 'BUY',
        orderCreationDate: 1_700_000_051_000,
        type: 'STICKY',
        price: 100,
        orderInstance: {} as any,
        symbol: 'BTC/USDT',
      });
      trader['prices'].set('BTC/USDT', 100);

      trader['emitOrderCompletedEvent'](advice.id, summary);

      // fee = 2 * 100 * 0.5% = 1
      // effective price = 100 + 100 * 0.5% = 100.5

      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_COMPLETED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({
            effectivePrice: 100.5,
            fee: 1,
            symbol: 'BTC/USDT',
          }),
          exchange: { price: 100, portfolio: trader['portfolio'] },
        }),
      );
    });
  });

  describe('getStaticConfiguration', () => {
    it('exposes expected metadata', () => {
      const configInfo = Trader.getStaticConfiguration();
      expect(configInfo.name).toBe('Trader');
      expect(configInfo.eventsEmitted).toEqual(
        expect.arrayContaining([
          PORTFOLIO_CHANGE_EVENT,
          ORDER_CANCELED_EVENT,
          ORDER_COMPLETED_EVENT,
          ORDER_ERRORED_EVENT,
          ORDER_INITIATED_EVENT,
        ]),
      );
    });
  });
});
