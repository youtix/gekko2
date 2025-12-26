import {
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INITIATED_EVENT,
  ORDER_INVALID_EVENT,
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { AdviceOrder } from '@models/advice.types';
import { OrderSide } from '@models/order.types';
import { OrderSummary } from '@services/core/order/order.types';
import { addMinutes } from 'date-fns';
import * as lodash from 'lodash-es';
import type { Mock } from 'vitest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../services/configuration/configuration';
import * as logger from '../../services/logger';
import * as processUtils from '../../utils/process/process.utils';
import { Trader } from './trader';
import * as traderUtils from './trader.utils';

vi.mock('@services/logger');

const baseWatch = {
  asset: 'BTC',
  currency: 'USDT',
  tickrate: 1000,
  mode: 'realtime' as const,
  timeframe: '1m' as const,
  fillGaps: 'empty' as const,
  warmup: { tickrate: 1000, candleCount: 0 },
  daterange: null,
};

const cloneWatch = () => ({
  ...baseWatch,
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
    id: string,
    side: string,
    amount: number,
    priceOrExchange: unknown,
    maybeExchange?: unknown,
  ) {
    ensureStore(this);
    this.id = id;
    this.side = side;
    this.amount = amount;
    this.price = requiresPrice ? priceOrExchange : undefined;
    this.exchange = requiresPrice ? maybeExchange : priceOrExchange;
    this.cancel = vi.fn();
    this.launch = vi.fn();
    this.createSummary = vi.fn().mockResolvedValue({
      amount: this.amount,
      price: 100,
      feePercent: 0.25,
      side: this.side,
      date: 1_700_000_000_000,
    });
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

  return MockOrder as unknown as new (id: string, side: string, amount: number, exchange: unknown) => any;
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
    fakeExchange = {
      getExchangeName: vi.fn(() => 'MockExchange'),
      getIntervals: vi.fn(() => ({ exchangeSync: 1, orderSync: 1 })),
      fetchTicker: vi.fn().mockResolvedValue({ bid: 123 }),
      fetchBalance: vi.fn().mockResolvedValue({
        asset: { free: 1, used: 0, total: 1 },
        currency: { free: 2, used: 0, total: 2 },
      }),
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
      ${'warmupCandle'}    | ${null}
      ${'portfolio'}       | ${{ asset: { free: 0, used: 0, total: 0 }, currency: { free: 0, used: 0, total: 0 } }}
      ${'balance'}         | ${{ free: 0, used: 0, total: 0 }}
      ${'price'}           | ${0}
    `('initializes $field to $expected', ({ field, expected }) => {
      expect((trader as any)[field]).toEqual(expected);
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
    it('should fetch portfolio from exchange', async () => {
      trader['currentTimestamp'] = 0;

      await trader['synchronize']();

      expect(fakeExchange.fetchBalance).toHaveBeenCalledTimes(1);
    });
    it('should update trader plugin portfolio with exchange portfolio', async () => {
      trader['currentTimestamp'] = 0;
      trader['portfolio'] = {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 0, used: 0, total: 0 },
      };
      fakeExchange.fetchBalance.mockResolvedValue({
        asset: { free: 3, used: 0, total: 3 },
        currency: { free: 50, used: 0, total: 50 },
      });

      await trader['synchronize']();

      expect(trader['portfolio']).toStrictEqual({
        asset: { free: 3, used: 0, total: 3 },
        currency: { free: 50, used: 0, total: 50 },
      });
    });
    it('should update balance', async () => {
      trader['currentTimestamp'] = 0;
      trader['balance'] = { free: 0, used: 0, total: 0 };
      trader['portfolio'] = {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 0, used: 0, total: 0 },
      };
      trader['price'] = 200;
      fakeExchange.fetchBalance.mockResolvedValue({
        asset: { free: 3, used: 0, total: 3 },
        currency: { free: 50, used: 0, total: 50 },
      });
      fakeExchange.fetchTicker.mockResolvedValue({ bid: 200 });

      await trader['synchronize']();

      expect(trader['balance'].total).toBeCloseTo(650);
    });
    it.each`
      action                                                                | oldPortfolio                                                                             | newPortfolio                                                                             | expectedEmit
      ${'NOT emit portfolio change event because portfolio did not change'} | ${{ asset: { free: 3, used: 0, total: 3 }, currency: { free: 50, used: 0, total: 50 } }} | ${{ asset: { free: 3, used: 0, total: 3 }, currency: { free: 50, used: 0, total: 50 } }} | ${false}
      ${'emit portfolio change event because portfolio changed'}            | ${{ asset: { free: 0, used: 0, total: 0 }, currency: { free: 0, used: 0, total: 0 } }}   | ${{ asset: { free: 3, used: 0, total: 3 }, currency: { free: 50, used: 0, total: 50 } }} | ${true}
    `('should $action', async ({ oldPortfolio, newPortfolio, expectedEmit }) => {
      trader['emitPortfolioChangeEvent'] = vi.fn();
      trader['portfolio'] = oldPortfolio;
      fakeExchange.fetchBalance.mockResolvedValue(newPortfolio);

      await trader['synchronize']();

      if (expectedEmit) expect(trader['emitPortfolioChangeEvent']).toHaveBeenCalledOnce();
      else expect(trader['emitPortfolioChangeEvent']).not.toHaveBeenCalled();
    });
    it.each`
      action                                                                    | oldBalance                            | portfolio                                                                                | price  | expectedEmit
      ${'NOT emit portfolio value change event because balance did not change'} | ${{ free: 650, used: 0, total: 650 }} | ${{ asset: { free: 3, used: 0, total: 3 }, currency: { free: 50, used: 0, total: 50 } }} | ${200} | ${false}
      ${'emit portfolio value change event because balance changed'}            | ${{ free: 100, used: 0, total: 100 }} | ${{ asset: { free: 3, used: 0, total: 3 }, currency: { free: 50, used: 0, total: 50 } }} | ${200} | ${true}
    `('should $action', async ({ timestamp, oldBalance, portfolio, price, expectedEmit }) => {
      trader['emitPortfolioValueChangeEvent'] = vi.fn();
      trader['currentTimestamp'] = timestamp;
      trader['balance'] = oldBalance;
      trader['portfolio'] = portfolio;
      trader['price'] = price;
      fakeExchange.fetchBalance.mockResolvedValue(portfolio);
      fakeExchange.fetchTicker.mockResolvedValue({ bid: price });

      await trader['synchronize']();

      if (expectedEmit) expect(trader['emitPortfolioValueChangeEvent']).toHaveBeenCalledOnce();
      else expect(trader['emitPortfolioValueChangeEvent']).not.toHaveBeenCalled();
    });
  });

  describe('portfolio event emitters', () => {
    it('defers portfolio change events with current asset and currency', () => {
      trader['portfolio'] = {
        asset: { free: 10, used: 0, total: 10 },
        currency: { free: 25, used: 0, total: 25 },
      };
      trader['emitPortfolioChangeEvent']();
      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(PORTFOLIO_CHANGE_EVENT, {
        asset: { free: 10, used: 0, total: 10 },
        currency: { free: 25, used: 0, total: 25 },
      });
    });

    it('defers portfolio value events with current balance', () => {
      trader['balance'] = { free: 321.45, used: 0, total: 321.45 };
      trader['emitPortfolioValueChangeEvent']();
      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: { free: 321.45, used: 0, total: 321.45 },
      });
    });
  });

  describe('onStrategyWarmupCompleted', () => {
    it('should set warmupCompleted to true', async () => {
      trader['warmupCompleted'] = false;
      trader['warmupCandle'] = defaultCandle;
      trader['processOneMinuteCandle'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted();

      expect(trader['warmupCompleted']).toBeTruthy();
    });

    it('should reset warmupCandle to null', async () => {
      trader['warmupCompleted'] = false;
      trader['warmupCandle'] = defaultCandle;
      trader['processOneMinuteCandle'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted();

      expect(trader['warmupCandle']).toBeNull();
    });

    it('should call processOneMinuteCandle when buffered candle is set', async () => {
      trader['warmupCompleted'] = false;
      trader['warmupCandle'] = defaultCandle;
      trader['processOneMinuteCandle'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted();

      expect(trader['processOneMinuteCandle']).toHaveBeenCalledExactlyOnceWith(defaultCandle);
    });

    it('should NOT call processOneMinuteCandle when buffered candle is NOT set', async () => {
      trader['warmupCompleted'] = false;
      trader['warmupCandle'] = null;
      trader['processOneMinuteCandle'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted();

      expect(trader['processOneMinuteCandle']).not.toHaveBeenCalled();
    });

    it('should synchronize with exchange', async () => {
      trader['warmupCompleted'] = false;
      trader['warmupCandle'] = defaultCandle;
      trader['processOneMinuteCandle'] = vi.fn();
      trader['synchronize'] = vi.fn();

      await trader.onStrategyWarmupCompleted();

      expect(trader['synchronize']).toHaveBeenCalledOnce();
    });
  });

  describe('processOneMinuteCandle', () => {
    it('should update price', async () => {
      trader['price'] = 0;
      trader['synchronize'] = vi.fn();

      await trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['price']).toBe(100);
    });

    it('should NOT triggers synchronize when trader plugin is initialized', async () => {
      trader['currentTimestamp'] = Date.now(); // => Means trader plugin is iitialized
      trader['synchronize'] = vi.fn();
      fakeExchange['getIntervals'].mockReturnValue({ exchangeSync: 1_000, orderSync: 1 });
      const shiftedCandle = { ...defaultCandle, start: addMinutes(defaultCandle.start, 1).getTime() };

      await trader['processOneMinuteCandle'](shiftedCandle);

      expect(trader['synchronize']).not.toHaveBeenCalled();
    });

    it('should update currentTimestamp', async () => {
      trader['currentTimestamp'] = 0;
      trader['synchronize'] = vi.fn();

      await trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['currentTimestamp']).toBe(1700000060000); // +1 minute
    });

    it('should buffer candle until warmup completes', async () => {
      trader['warmupCompleted'] = false;
      await trader['processOneMinuteCandle'](defaultCandle);
      expect(trader['warmupCandle']).toBe(defaultCandle);
    });

    it('should NOT buffer candle once warmup completes', async () => {
      trader['warmupCompleted'] = true;
      trader['warmupCandle'] = null;

      await trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['warmupCandle']).toBeNull();
    });
  });

  describe('onStrategyCreateOrder', () => {
    const getInitiatedEvent = () => {
      const emitCalls = (trader['addDeferredEmit'] as unknown as Mock).mock.calls;
      return emitCalls.find(call => call[0] === ORDER_INITIATED_EVENT)?.[1];
    };
    const getInitiatedOrder = () => getInitiatedEvent()?.order;

    beforeEach(() => {
      trader['price'] = 100;
      trader['portfolio'] = {
        asset: { free: 3, used: 0, total: 3 },
        currency: { free: 1000, used: 0, total: 1000 },
      };
    });

    it('creates order and emits initiation event for BUY advice', async () => {
      const advice = buildAdvice();

      await trader.onStrategyCreateOrder([advice]);

      expect(getOrdersMap().size).toBe(1);
      const initiated = getInitiatedOrder();
      expect(initiated?.id).toBe(advice.id);
      expect(initiated?.type).toBe(advice.type);
      expect(initiated?.amount).toBeCloseTo(9.5, 5);
    });

    it('computes SELL order amount from asset holdings', async () => {
      trader['portfolio'] = {
        asset: { free: 2.5, used: 0, total: 2.5 },
        currency: { free: 0, used: 0, total: 0 },
      };
      const advice = buildAdvice({ side: 'SELL', type: 'MARKET' });

      await trader.onStrategyCreateOrder([advice]);

      const initiated = getInitiatedOrder();
      expect(initiated?.amount).toBeCloseTo(2.5, 5);
    });

    it('uses provided quantity when present', async () => {
      const advice = buildAdvice({ amount: 1.2345, type: 'MARKET', side: 'BUY' });

      await trader.onStrategyCreateOrder([advice]);

      const initiated = getInitiatedOrder();
      expect(initiated?.amount).toBeCloseTo(1.2345, 5);
      const metadata = getOrderMetadata(advice.id);
      expect(metadata?.amount).toBeCloseTo(1.2345, 5);
      expect(metadata?.orderInstance.amount).toBeCloseTo(1.2345, 5);
    });

    it('creates limit order with requested price and no amount buffer when quantity missing', async () => {
      trader['portfolio'] = {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 1000, used: 0, total: 1000 },
      };
      const advice = buildAdvice({ type: 'LIMIT', side: 'BUY', price: 95 });

      await trader.onStrategyCreateOrder([advice]);

      const initiated = getInitiatedOrder();
      expect(initiated?.price).toBe(95);
      expect(initiated?.amount).toBeCloseTo(10, 5);
      const metadata = getOrderMetadata(advice.id);
      expect(metadata?.price).toBe(95);
    });

    it('handles ORDER_ERRORED_EVENT by emitting error and removing order', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      (logger.error as Mock).mockClear();

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_ERRORED_EVENT, 'boom');
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith(
        'trader',
        '[20a7abd2-546b-4c65-b04d-900b84fa5fe6] BUY STICKY order: boom (status: ERROR)',
      );
      expect(getOrdersMap().size).toBe(0);
      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({
            id: advice.id,
            reason: 'boom',
            type: advice.type,
            side: advice.side,
          }),
          exchange: expect.objectContaining({
            price: trader['price'],
            portfolio: trader['portfolio'],
            balance: trader['balance'],
          }),
        }),
      );
      expect(synchronizeSpy).toHaveBeenCalled();
    });

    it('removes order and synchronizes when receiving ORDER_INVALID_EVENT', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_INVALID_EVENT, { reason: 'limit too low' });
      await Promise.resolve();

      expect(logger.info).toHaveBeenCalledWith('trader', expect.stringContaining('limit too low'));
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(getOrdersMap().size).toBe(0);
      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({
            id: advice.id,
            type: advice.type,
            side: advice.side,
            reason: 'limit too low',
          }),
          exchange: expect.objectContaining({
            price: trader['price'],
            portfolio: trader['portfolio'],
            balance: trader['balance'],
          }),
        }),
      );
    });

    it('delegates ORDER_COMPLETED_EVENT to emitOrderCompletedEvent', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      const emitSpy = vi.spyOn(
        trader as unknown as { emitOrderCompletedEvent: (id: string, summary: unknown) => void },
        'emitOrderCompletedEvent',
      );

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_COMPLETED_EVENT);
      await Promise.resolve();
      await Promise.resolve();

      expect(order.createSummary).toHaveBeenCalledTimes(1);
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(advice.id, expect.objectContaining({ side: advice.side }));
      expect(getOrdersMap().size).toBe(0);
    });

    it('logs error and removes order when order summary creation fails', async () => {
      const advice = buildAdvice();
      const errorMock = logger.error as Mock;
      errorMock.mockClear();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      const emitSpy = vi.spyOn(
        trader as unknown as { emitOrderCompletedEvent: (id: string, summary: unknown) => void },
        'emitOrderCompletedEvent',
      );

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;
      (order.createSummary as Mock).mockRejectedValue(new Error('summary failed'));

      order.emit(ORDER_COMPLETED_EVENT);
      await Promise.resolve();
      await Promise.resolve();

      expect(errorMock).toHaveBeenCalledWith(
        'trader',
        '[20a7abd2-546b-4c65-b04d-900b84fa5fe6] Error in order completed summary failed',
      );
      expect(emitSpy).not.toHaveBeenCalled();
      expect(synchronizeSpy).not.toHaveBeenCalled();
      expect(getOrdersMap().size).toBe(0);
    });
  });

  describe('onStrategyCancelOrder', () => {
    it('warns when order is unknown', async () => {
      await trader.onStrategyCancelOrder(['missing-id' as any]);
      expect(logger.warning).toHaveBeenCalledWith('trader', '[missing-id] Impossible to cancel order: Unknown Order');
    });

    it('removes listeners, cancels order, and emits cancellation after completion', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      trader['price'] = 100;
      trader['portfolio'] = {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 1000, used: 0, total: 1000 },
      };
      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      await trader.onStrategyCancelOrder([advice.id]);

      expect(order.removeAllListeners).toHaveBeenCalled();
      expect(order.cancel).toHaveBeenCalled();

      order.emit(ORDER_CANCELED_EVENT, { filled: 2, remaining: 7.5, partiallyFilled: true });
      await Promise.resolve();

      expect(getOrdersMap().size).toBe(0);
      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_CANCELED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({
            id: advice.id,
            type: advice.type,
            side: advice.side,
            amount: expect.any(Number),
            filled: 2,
            remaining: 7.5,
            price: 100,
          }),
          exchange: expect.objectContaining({
            price: trader['price'],
            portfolio: trader['portfolio'],
            balance: trader['balance'],
          }),
        }),
      );
      const cancelPayload = (trader['addDeferredEmit'] as Mock).mock.calls
        .filter(call => call[0] === ORDER_CANCELED_EVENT)
        .pop()?.[1].order;
      expect(cancelPayload?.amount).toBeCloseTo(9.5, 5);
      expect(synchronizeSpy).toHaveBeenCalled();
    });

    it('includes requested price when canceling limit orders', async () => {
      trader['price'] = 100;
      trader['portfolio'] = {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 1000, used: 0, total: 1000 },
      };
      const advice = buildAdvice({ type: 'LIMIT', side: 'SELL', price: 210 });
      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;
      const metadata = getOrderMetadata(advice.id);
      expect(metadata?.price).toBe(210);
      expect(metadata?.side).toBe('SELL');

      await trader.onStrategyCancelOrder([advice.id]);
      order.emit(ORDER_CANCELED_EVENT, { filled: 0, remaining: 5, partiallyFilled: false });
      await Promise.resolve();
    });

    it('removes order and emits error when cancellation fails', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      trader['price'] = 100;
      trader['portfolio'] = {
        asset: { free: 0, used: 0, total: 0 },
        currency: { free: 1000, used: 0, total: 1000 },
      };
      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      await trader.onStrategyCancelOrder([advice.id]);

      expect(order.removeAllListeners).toHaveBeenCalled();
      expect(order.cancel).toHaveBeenCalled();

      order.emit(ORDER_ERRORED_EVENT, 'exchange timeout');
      await Promise.resolve();

      expect(getOrdersMap().size).toBe(0);
      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({
            id: advice.id,
            type: advice.type,
            side: advice.side,
            reason: 'exchange timeout',
          }),
          exchange: expect.objectContaining({
            price: trader['price'],
            portfolio: trader['portfolio'],
            balance: trader['balance'],
          }),
        }),
      );
      expect(synchronizeSpy).toHaveBeenCalled();
    });
  });

  describe('emitOrderCompletedEvent', () => {
    it('throws error when order summary is missing timestamp', () => {
      const summary = {
        amount: 1,
        price: 100,
        feePercent: 0.5,
        side: 'BUY',
        date: undefined,
      } as any;

      expect(() => trader['emitOrderCompletedEvent']('order-id' as any, summary)).toThrow(GekkoError);
    });

    it('emits completion summary with computed pricing', async () => {
      const summary: OrderSummary = {
        amount: 2,
        price: 100,
        feePercent: 0.5,
        side: 'BUY' as OrderSide,
        orderExecutionDate: 1_700_000_111_000,
      };
      const processCostSpy = vi
        .spyOn(traderUtils, 'computeOrderPricing')
        .mockReturnValue({ effectivePrice: 101, fee: 2, base: 100, total: 102 });

      trader['portfolio'] = {
        asset: { free: 5, used: 0, total: 5 },
        currency: { free: 10, used: 0, total: 10 },
      };
      trader['balance'] = { free: 510, used: 0, total: 510 };
      trader['price'] = 100;
      trader['orders'].set('order-id' as any, {
        amount: summary.amount,
        side: summary.side,
        orderCreationDate: summary.orderExecutionDate - 60_000,
        type: 'STICKY',
        price: summary.price,
        orderInstance: {} as any,
      });

      trader['emitOrderCompletedEvent']('order-id' as any, summary);

      expect(processCostSpy).toHaveBeenCalledWith(summary.side, summary.price, summary.amount, summary.feePercent);
      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_COMPLETED_EVENT,
        expect.objectContaining({
          order: expect.objectContaining({
            id: 'order-id',
            side: summary.side,
            amount: summary.amount,
            price: summary.price,
            feePercent: summary.feePercent,
            effectivePrice: 101,
            fee: 2,
            type: 'STICKY',
            orderExecutionDate: summary.orderExecutionDate,
          }),
          exchange: expect.objectContaining({
            portfolio: trader['portfolio'],
            balance: trader['balance'],
            price: trader['price'],
          }),
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
          PORTFOLIO_VALUE_CHANGE_EVENT,
          ORDER_CANCELED_EVENT,
          ORDER_COMPLETED_EVENT,
          ORDER_ERRORED_EVENT,
          ORDER_INITIATED_EVENT,
        ]),
      );
      expect(configInfo.eventsHandlers.every(handler => handler.startsWith('on'))).toBe(true);
    });
  });
});
