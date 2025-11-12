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
import { Advice } from '@models/advice.types';
import { OrderSide } from '@models/order.types';
import * as lodash from 'lodash-es';
import type { Mock } from 'vitest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../services/configuration/configuration';
import * as logger from '../../services/logger';
import * as processUtils from '../../utils/process/process.utils';
import { Trader } from './trader';
import { SYNCHRONIZATION_INTERVAL } from './trader.const';
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
    getInterval: Mock;
    fetchTicker: Mock;
    fetchPortfolio: Mock;
    getMarketLimits: Mock;
  };
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;
  let waitSpy: ReturnType<typeof vi.spyOn>;
  const getWatchMock = config.getWatch as unknown as Mock;
  const getExchangeMock = config.getExchange as unknown as Mock;
  const getStrategyMock = config.getStrategy as unknown as Mock;

  const getOrdersMap = () => (trader as any).orders;
  const getOrderMetadata = (id: string) => getOrdersMap().get(id);
  const getOrderInstance = (id: string) => getOrderMetadata(id)?.orderInstance;

  const buildAdvice = (overrides?: Partial<Advice>): Advice => {
    const orderOverrides = overrides?.order ?? {};
    return {
      id: overrides?.id ?? '20a7abd2-546b-4c65-b04d-900b84fa5fe6',
      date: overrides?.date ?? 1_700_000_000_100,
      order: {
        type: 'STICKY',
        side: 'BUY',
        quantity: undefined,
        ...orderOverrides,
      },
    };
  };

  beforeAll(() => {
    vi.useFakeTimers();
    // @ts-expect-error do not need to fix
    setIntervalSpy = vi.spyOn(global, 'setInterval');
    clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    // @ts-expect-error do not need to fix
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
      getInterval: vi.fn(() => 42),
      fetchTicker: vi.fn().mockResolvedValue({ bid: 123 }),
      fetchPortfolio: vi.fn().mockResolvedValue({ asset: 1, currency: 2 }),
      getMarketLimits: vi.fn(() => undefined),
    };

    trader['getExchange'] = vi.fn().mockReturnValue(fakeExchange);
    trader['deferredEmit'] = vi.fn();
  });

  afterEach(() => {
    trader?.['processFinalize']?.();
  });

  describe('constructor', () => {
    it.each`
      field                | expected
      ${'warmupCompleted'} | ${false}
      ${'warmupCandle'}    | ${null}
      ${'portfolio'}       | ${{ asset: 0, currency: 0 }}
      ${'balance'}         | ${0}
      ${'price'}           | ${0}
    `('initializes $field to $expected', ({ field, expected }) => {
      expect((trader as any)[field]).toEqual(expected);
    });

    it('initializes orders collection as empty map', () => {
      const orders = getOrdersMap();
      expect(orders).toBeInstanceOf(Map);
      expect(orders.size).toBe(0);
    });

    it('binds synchronize and schedules interval when running in realtime mode', () => {
      const bindAllMock = lodash.bindAll as unknown as Mock;
      expect(bindAllMock).toHaveBeenCalledWith(trader, ['synchronize']);
      expect(setIntervalSpy).toHaveBeenCalledWith(trader['synchronize'], SYNCHRONIZATION_INTERVAL);
    });

    it('schedules synchronization even when running in backtest mode and cleans it up on finalize', () => {
      setIntervalSpy.mockClear();
      clearIntervalSpy.mockClear();
      getWatchMock.mockReturnValue({ ...cloneWatch(), mode: 'backtest' });
      const backtestTrader = new Trader();

      expect(setIntervalSpy).toHaveBeenCalledWith(backtestTrader['synchronize'], SYNCHRONIZATION_INTERVAL);
      backtestTrader['processFinalize']();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect(backtestTrader['syncInterval']).toBeNull();
    });
  });

  describe('synchronize', () => {
    it('should fetch portfolio from exchange', async () => {
      trader['currentTimestamp'] = 0;

      await trader['synchronize']();

      expect(fakeExchange.fetchPortfolio).toHaveBeenCalledTimes(1);
    });
    it('should update trader plugin portfolio with exchange portfolio', async () => {
      trader['currentTimestamp'] = 0;
      trader['portfolio'] = { asset: 0, currency: 0 };
      fakeExchange.fetchPortfolio.mockResolvedValue({ asset: 3, currency: 50 });

      await trader['synchronize']();

      expect(trader['portfolio']).toStrictEqual({ asset: 3, currency: 50 });
    });
    it('should update balance', async () => {
      trader['currentTimestamp'] = 0;
      trader['balance'] = 0;
      trader['portfolio'] = { asset: 0, currency: 0 };
      trader['price'] = 200;
      fakeExchange.fetchPortfolio.mockResolvedValue({ asset: 3, currency: 50 });

      await trader['synchronize']();

      expect(trader['balance']).toBeCloseTo(650);
    });
    it.each`
      action                                                                                     | timestamp     | oldPortfolio                  | newPortfolio                  | expectedEmit
      ${'NOT emit portfolio change event because trader is initializing its data'}               | ${0}          | ${{ asset: 0, currency: 0 }}  | ${{ asset: 3, currency: 50 }} | ${false}
      ${'NOT emit portfolio change event because portfolio did not change'}                      | ${Date.now()} | ${{ asset: 3, currency: 50 }} | ${{ asset: 3, currency: 50 }} | ${false}
      ${'emit portfolio change event because trader plugin is initilized and portfolio changed'} | ${Date.now()} | ${{ asset: 0, currency: 0 }}  | ${{ asset: 3, currency: 50 }} | ${true}
    `('should $action', async ({ timestamp, oldPortfolio, newPortfolio, expectedEmit }) => {
      trader['emitPortfolioChangeEvent'] = vi.fn();
      trader['currentTimestamp'] = timestamp;
      trader['portfolio'] = oldPortfolio;
      fakeExchange.fetchPortfolio.mockResolvedValue(newPortfolio);

      await trader['synchronize']();

      if (expectedEmit) expect(trader['emitPortfolioChangeEvent']).toHaveBeenCalledOnce();
      else expect(trader['emitPortfolioChangeEvent']).not.toHaveBeenCalled();
    });
    it.each`
      action                                                                                         | timestamp     | oldBalance | portfolio                     | price  | expectedEmit
      ${'NOT emit portfolio value change event because trader is initializing its data'}             | ${0}          | ${0}       | ${{ asset: 3, currency: 50 }} | ${200} | ${false}
      ${'NOT emit portfolio value change event because balance did not change'}                      | ${Date.now()} | ${650}     | ${{ asset: 3, currency: 50 }} | ${200} | ${false}
      ${'emit portfolio value change event because trader plugin is initilized and balance changed'} | ${Date.now()} | ${100}     | ${{ asset: 3, currency: 50 }} | ${200} | ${true}
    `('should $action', async ({ timestamp, oldBalance, portfolio, price, expectedEmit }) => {
      trader['emitPortfolioValueChangeEvent'] = vi.fn();
      trader['currentTimestamp'] = timestamp;
      trader['balance'] = oldBalance;
      trader['portfolio'] = portfolio;
      trader['price'] = price;
      fakeExchange.fetchPortfolio.mockResolvedValue(portfolio);

      await trader['synchronize']();

      if (expectedEmit) expect(trader['emitPortfolioValueChangeEvent']).toHaveBeenCalledOnce();
      else expect(trader['emitPortfolioValueChangeEvent']).not.toHaveBeenCalled();
    });
  });

  describe('portfolio event emitters', () => {
    it('defers portfolio change events with current asset and currency', () => {
      trader['portfolio'] = { asset: 10, currency: 25 };
      trader['emitPortfolioChangeEvent']();
      expect(trader['deferredEmit']).toHaveBeenCalledWith(PORTFOLIO_CHANGE_EVENT, {
        asset: 10,
        currency: 25,
      });
    });

    it('defers portfolio value events with current balance', () => {
      trader['balance'] = 321.45;
      trader['emitPortfolioValueChangeEvent']();
      expect(trader['deferredEmit']).toHaveBeenCalledWith(PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 321.45,
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

    it('should triggers synchronize when trader plugin is not initialized', async () => {
      trader['currentTimestamp'] = 0; // => Means that trader plugin is not iitialized
      trader['synchronize'] = vi.fn();

      await trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['synchronize']).toHaveBeenCalledTimes(1);
    });

    it('should NOT triggers synchronize when trader plugin is initialized', async () => {
      trader['currentTimestamp'] = Date.now(); // => Means trader plugin is iitialized
      trader['synchronize'] = vi.fn();

      await trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['synchronize']).not.toHaveBeenCalledTimes(1);
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
    const getInitiatedPayload = () => {
      const emitCalls = (trader['deferredEmit'] as unknown as Mock).mock.calls;
      return emitCalls.find(call => call[0] === ORDER_INITIATED_EVENT)?.[1];
    };

    beforeEach(() => {
      trader['price'] = 100;
      trader['portfolio'] = { asset: 3, currency: 1000 };
    });

    it('creates order and emits initiation event for BUY advice', () => {
      const advice = buildAdvice();

      trader.onStrategyCreateOrder(advice);

      expect(getOrdersMap().size).toBe(1);
      const initiated = getInitiatedPayload();
      expect(initiated?.orderId).toBe(advice.id);
      expect(initiated?.type).toBe(advice.order.type);
      expect(initiated?.amount).toBeCloseTo(9.5, 5);
    });

    it('computes SELL order amount from asset holdings', () => {
      trader['portfolio'] = { asset: 2.5, currency: 0 };
      const advice = buildAdvice({ order: { side: 'SELL', type: 'MARKET' } });

      trader.onStrategyCreateOrder(advice);

      const initiated = getInitiatedPayload();
      expect(initiated?.amount).toBeCloseTo(2.5, 5);
    });

    it('uses provided quantity when present', () => {
      const advice = buildAdvice({ order: { quantity: 1.2345, type: 'MARKET', side: 'BUY' } });

      trader.onStrategyCreateOrder(advice);

      const initiated = getInitiatedPayload();
      expect(initiated?.amount).toBeCloseTo(1.2345, 5);
      const metadata = getOrderMetadata(advice.id);
      expect(metadata?.amount).toBeCloseTo(1.2345, 5);
      expect(metadata?.orderInstance.amount).toBeCloseTo(1.2345, 5);
    });

    it('creates limit order with requested price and no amount buffer when quantity missing', () => {
      trader['portfolio'] = { asset: 0, currency: 1000 };
      const advice = buildAdvice({ order: { type: 'LIMIT', side: 'BUY', price: 95 } });

      trader.onStrategyCreateOrder(advice);

      const initiated = getInitiatedPayload();
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

      trader.onStrategyCreateOrder(advice);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_ERRORED_EVENT, 'boom');
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith('trader', 'Gekko received error: boom');
      expect(getOrdersMap().size).toBe(0);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          reason: 'boom',
          type: advice.order.type,
          side: advice.order.side,
        }),
      );
      expect(synchronizeSpy).toHaveBeenCalled();
    });

    it('removes order and synchronizes when receiving ORDER_INVALID_EVENT', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);

      trader.onStrategyCreateOrder(advice);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_INVALID_EVENT, { reason: 'limit too low' });
      await Promise.resolve();

      expect(logger.info).toHaveBeenCalledWith('trader', 'Order rejected : limit too low');
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(getOrdersMap().size).toBe(0);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          type: advice.order.type,
          side: advice.order.side,
          reason: 'limit too low',
        }),
      );
    });

    it('delegates ORDER_COMPLETED_EVENT to emitOrderCompletedEvent', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      const emitSpy = vi.spyOn(
        trader as unknown as { emitOrderCompletedEvent: (id: string, type: string, summary: unknown) => void },
        'emitOrderCompletedEvent',
      );

      trader.onStrategyCreateOrder(advice);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_COMPLETED_EVENT);
      await Promise.resolve();
      await Promise.resolve();

      expect(order.createSummary).toHaveBeenCalledTimes(1);
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(
        advice.id,
        advice.order.type,
        expect.objectContaining({ side: advice.order.side }),
      );
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
        trader as unknown as { emitOrderCompletedEvent: (id: string, type: string, summary: unknown) => void },
        'emitOrderCompletedEvent',
      );

      trader.onStrategyCreateOrder(advice);
      const order = getOrderInstance(advice.id)!;
      (order.createSummary as Mock).mockRejectedValue(new Error('summary failed'));

      order.emit(ORDER_COMPLETED_EVENT);
      await Promise.resolve();
      await Promise.resolve();

      expect(errorMock).toHaveBeenCalledWith('trader', 'summary failed');
      expect(emitSpy).not.toHaveBeenCalled();
      expect(synchronizeSpy).not.toHaveBeenCalled();
      expect(getOrdersMap().size).toBe(0);
    });
  });

  describe('onStrategyCancelOrder', () => {
    it('warns when order is unknown', () => {
      trader.onStrategyCancelOrder('missing-id' as any);
      expect(logger.warning).toHaveBeenCalledWith('trader', 'Impossible to cancel order: Unknown Order');
    });

    it('removes listeners, cancels order, and emits cancellation after completion', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      trader['price'] = 100;
      trader['portfolio'] = { asset: 0, currency: 1000 };
      trader.onStrategyCreateOrder(advice);
      const order = getOrderInstance(advice.id)!;

      trader.onStrategyCancelOrder(advice.id);

      expect(order.removeAllListeners).toHaveBeenCalled();
      expect(order.cancel).toHaveBeenCalled();

      order.emit(ORDER_CANCELED_EVENT, { filled: 2, remaining: 7.5, partiallyFilled: true });
      await Promise.resolve();

      expect(getOrdersMap().size).toBe(0);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_CANCELED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          type: advice.order.type,
          side: advice.order.side,
          amount: expect.any(Number),
          filled: 2,
          remaining: 7.5,
          price: 100,
        }),
      );
      const cancelPayload = (trader['deferredEmit'] as Mock).mock.calls
        .filter(call => call[0] === ORDER_CANCELED_EVENT)
        .pop()?.[1];
      expect(cancelPayload?.amount).toBeCloseTo(9.5, 5);
      expect(synchronizeSpy).toHaveBeenCalled();
    });

    it('includes requested price when canceling limit orders', async () => {
      trader['price'] = 100;
      trader['portfolio'] = { asset: 0, currency: 1000 };
      const advice = buildAdvice({ order: { type: 'LIMIT', side: 'SELL', price: 210 } });
      trader.onStrategyCreateOrder(advice);
      const order = getOrderInstance(advice.id)!;

      trader.onStrategyCancelOrder(advice.id);
      order.emit(ORDER_CANCELED_EVENT, { filled: 0, remaining: 5, partiallyFilled: false });
      await Promise.resolve();

      const payload = (trader['deferredEmit'] as Mock).mock.calls
        .filter(call => call[0] === ORDER_CANCELED_EVENT)
        .pop()?.[1];
      expect(payload?.price).toBe(210);
      expect(payload?.side).toBe('SELL');
    });

    it('removes order and emits error when cancellation fails', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      trader['price'] = 100;
      trader['portfolio'] = { asset: 0, currency: 1000 };
      trader.onStrategyCreateOrder(advice);
      const order = getOrderInstance(advice.id)!;

      trader.onStrategyCancelOrder(advice.id);

      expect(order.removeAllListeners).toHaveBeenCalled();
      expect(order.cancel).toHaveBeenCalled();

      order.emit(ORDER_ERRORED_EVENT, 'exchange timeout');
      await Promise.resolve();

      expect(getOrdersMap().size).toBe(0);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          type: advice.order.type,
          side: advice.order.side,
          reason: 'exchange timeout',
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

      expect(() => trader['emitOrderCompletedEvent']('order-id' as any, 'MARKET', summary)).toThrow(GekkoError);
    });

    it('emits completion summary with computed pricing', async () => {
      const summary = {
        amount: 2,
        price: 100,
        feePercent: 0.5,
        side: 'BUY' as OrderSide,
        date: 1_700_000_111_000,
      };
      const processCostSpy = vi
        .spyOn(traderUtils, 'computeOrderPricing')
        .mockReturnValue({ effectivePrice: 101, fee: 2, base: 100, total: 102 });

      trader['portfolio'] = { asset: 5, currency: 10 };
      trader['balance'] = 510;

      trader['emitOrderCompletedEvent']('order-id' as any, 'STICKY', summary);

      expect(processCostSpy).toHaveBeenCalledWith(summary.side, summary.price, summary.amount, summary.feePercent);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_COMPLETED_EVENT,
        expect.objectContaining({
          orderId: 'order-id',
          side: summary.side,
          amount: summary.amount,
          price: summary.price,
          feePercent: summary.feePercent,
          effectivePrice: 101,
          fee: 2,
          type: 'STICKY',
          portfolio: trader['portfolio'],
          balance: trader['balance'],
        }),
      );
    });
  });

  describe('processFinalize', () => {
    it('clears synchronization interval if present', () => {
      trader['syncInterval'] = 123 as unknown as NodeJS.Timer;
      trader['processFinalize']();
      expect(clearIntervalSpy).toHaveBeenCalledWith(123);
      expect(trader['syncInterval']).toBeNull();
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
