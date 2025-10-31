import {
  ORDER_ABORTED_EVENT,
  ORDER_CANCELED_EVENT,
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_INITIATED_EVENT,
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { Advice } from '@models/advice.types';
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

function createOrderMock(orderType: 'STICKY' | 'MARKET') {
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

  function MockOrder(this: any, id: string, side: string, amount: number, _exchange: unknown) {
    ensureStore(this);
    this.id = id;
    this.side = side;
    this.amount = amount;
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
    return orderType;
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

describe('Trader', () => {
  let trader: Trader;
  let fakeExchange: {
    getExchangeName: Mock;
    getInterval: Mock;
    fetchTicker: Mock;
    fetchPortfolio: Mock;
  };
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;
  let waitSpy: ReturnType<typeof vi.spyOn>;
  const getWatchMock = config.getWatch as unknown as Mock;
  const getExchangeMock = config.getExchange as unknown as Mock;
  const getStrategyMock = config.getStrategy as unknown as Mock;

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
    };

    trader['getExchange'] = vi.fn().mockReturnValue(fakeExchange);
    trader['deferredEmit'] = vi.fn();
  });

  afterEach(() => {
    trader?.['processFinalize']?.();
  });

  describe('constructor', () => {
    it.each`
      field                     | expected
      ${'sendInitialPortfolio'} | ${false}
      ${'warmupCompleted'}      | ${false}
      ${'warmupCandle'}         | ${undefined}
      ${'portfolio'}            | ${{ asset: 0, currency: 0 }}
      ${'balance'}              | ${0}
      ${'price'}                | ${0}
    `('initializes $field to $expected', ({ field, expected }) => {
      expect((trader as any)[field]).toEqual(expected);
    });

    it('initializes orders collection as empty array', () => {
      const orders = (trader as any).orders;
      expect(Array.isArray(orders)).toBe(true);
      expect(orders).toHaveLength(0);
    });

    it('binds synchronize and schedules interval when running in realtime mode', () => {
      const bindAllMock = lodash.bindAll as unknown as Mock;
      expect(bindAllMock).toHaveBeenCalledWith(trader, ['synchronize']);
      expect(setIntervalSpy).toHaveBeenCalledWith(trader['synchronize'], SYNCHRONIZATION_INTERVAL);
    });

    it('does not schedule synchronization when running in backtest mode', () => {
      setIntervalSpy.mockClear();
      getWatchMock.mockReturnValue({ ...cloneWatch(), mode: 'backtest' });
      const backtestTrader = new Trader();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      backtestTrader['processFinalize']();
    });
  });

  describe('synchronize', () => {
    it('updates price and waits for exchange interval when price is unset', async () => {
      await trader['synchronize']();

      expect(fakeExchange.fetchTicker).toHaveBeenCalledTimes(1);
      expect(trader['price']).toBe(123);
      expect(waitSpy).toHaveBeenCalledWith(42);
    });

    it('skips ticker fetch when price is already known', async () => {
      trader['price'] = 250;
      const setBalanceSpy = vi.spyOn(trader as unknown as { setBalance: () => void }, 'setBalance');

      await trader['synchronize']();

      expect(fakeExchange.fetchTicker).not.toHaveBeenCalled();
      expect(waitSpy).not.toHaveBeenCalled();
      expect(setBalanceSpy).toHaveBeenCalledTimes(1);
    });

    it('emits portfolio change when initial portfolio was sent and values differ', async () => {
      trader['sendInitialPortfolio'] = true;
      trader['portfolio'] = { asset: 0.5, currency: 10 };
      fakeExchange.fetchPortfolio.mockResolvedValue({ asset: 1, currency: 20 });
      const emitSpy = vi.spyOn(
        trader as unknown as { emitPortfolioChangeEvent: () => void },
        'emitPortfolioChangeEvent',
      );

      await trader['synchronize']();

      expect(emitSpy).toHaveBeenCalled();
    });

    it('does not emit portfolio change when fetched portfolio matches current state', async () => {
      trader['sendInitialPortfolio'] = true;
      trader['portfolio'] = { asset: 1, currency: 2 };
      fakeExchange.fetchPortfolio.mockResolvedValue({ asset: 1, currency: 2 });
      const emitSpy = vi.spyOn(
        trader as unknown as { emitPortfolioChangeEvent: () => void },
        'emitPortfolioChangeEvent',
      );

      await trader['synchronize']();

      expect(emitSpy).not.toHaveBeenCalled();
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

  describe('setBalance', () => {
    it.each`
      description                                      | price  | portfolio                     | initialBalance | expectedBalance
      ${'keeps balance unchanged for empty portfolio'} | ${150} | ${{ asset: 0, currency: 0 }}  | ${123}         | ${123}
      ${'recalculates balance when holdings exist'}    | ${100} | ${{ asset: 2, currency: 10 }} | ${0}           | ${210}
    `(' $description', ({ price, portfolio, initialBalance, expectedBalance }) => {
      trader['price'] = price;
      trader['portfolio'] = portfolio;
      trader['balance'] = initialBalance;

      trader['setBalance']();

      expect(trader['balance']).toBeCloseTo(expectedBalance);
    });
  });

  describe('onStrategyWarmupCompleted', () => {
    it('throws when warmup candle is missing', () => {
      expect(() => trader.onStrategyWarmupCompleted()).toThrow(GekkoError);
    });

    it('processes stored warmup candle and clears state', () => {
      const candle = { close: 456 } as any;
      trader['warmupCandle'] = candle;
      const processSpy = vi
        .spyOn(
          trader as unknown as { processOneMinuteCandle: (c: typeof candle) => Promise<void> },
          'processOneMinuteCandle',
        )
        .mockResolvedValue(undefined);

      trader.onStrategyWarmupCompleted();

      expect(processSpy).toHaveBeenCalledWith(candle);
      expect(trader['warmupCandle']).toBeUndefined();
    });
  });

  describe('processOneMinuteCandle', () => {
    it('buffers candle until warmup completes', async () => {
      const candle = { close: 99 } as any;
      await trader['processOneMinuteCandle'](candle);
      expect(trader['warmupCandle']).toBe(candle);
      expect(trader['price']).toBe(0);
    });

    it('synchronizes and emits events after warmup', async () => {
      trader['warmupCompleted'] = true;
      trader['portfolio'] = { asset: 1, currency: 0 };
      const syncSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);
      const emitPortfolioChangeSpy = vi.spyOn(
        trader as unknown as { emitPortfolioChangeEvent: () => void },
        'emitPortfolioChangeEvent',
      );
      const emitPortfolioValueSpy = vi.spyOn(
        trader as unknown as { emitPortfolioValueChangeEvent: () => void },
        'emitPortfolioValueChangeEvent',
      );

      await trader['processOneMinuteCandle']({ close: 100 } as any);

      expect(trader['price']).toBe(100);
      expect(trader['sendInitialPortfolio']).toBe(true);
      expect(syncSpy).toHaveBeenCalled();
      expect(emitPortfolioChangeSpy).toHaveBeenCalled();
      expect(emitPortfolioValueSpy).toHaveBeenCalled();
    });

    it('does not emit portfolio value event when balance stays constant', async () => {
      trader['warmupCompleted'] = true;
      trader['sendInitialPortfolio'] = true;
      trader['balance'] = 50;
      trader['portfolio'] = { asset: 0, currency: 50 };
      const emitValueSpy = vi.spyOn(
        trader as unknown as { emitPortfolioValueChangeEvent: () => void },
        'emitPortfolioValueChangeEvent',
      );

      await trader['processOneMinuteCandle']({ close: 10 } as any);

      expect(emitValueSpy).not.toHaveBeenCalled();
    });
  });

  describe('onStrategyCreateOrder', () => {
    it('aborts BUY advice when amount is invalid', () => {
      trader['price'] = 0;
      trader['portfolio'] = { asset: 0, currency: 0 };
      const advice = buildAdvice();

      trader.onStrategyCreateOrder(advice);

      expect(logger.warning).toHaveBeenCalledWith('trader', expect.stringContaining('NOT buying 0'));
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_ABORTED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          reason: 'invalid amount (0)',
          orderType: advice.order.type,
          requestedAmount: 0,
        }),
      );
    });

    it('aborts SELL advice when holdings are insufficient', () => {
      trader['price'] = 100;
      trader['portfolio'] = { asset: 0, currency: 0 };
      const advice = buildAdvice({ order: { side: 'SELL', type: 'MARKET' } });

      trader.onStrategyCreateOrder(advice);

      expect(logger.warning).toHaveBeenCalledWith('trader', expect.stringContaining('NOT selling 0'));
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_ABORTED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          reason: 'invalid amount (0)',
          orderType: advice.order.type,
          requestedAmount: 0,
        }),
      );
    });

    it('delegates to createOrder for valid BUY advice', () => {
      trader['price'] = 100;
      trader['portfolio'] = { asset: 0, currency: 1000 };
      const advice = buildAdvice();
      const createOrderSpy = vi
        .spyOn(trader as unknown as { createOrder: (a: Advice, amount: number) => Promise<void> }, 'createOrder')
        .mockResolvedValue(undefined);

      trader.onStrategyCreateOrder(advice);

      expect(createOrderSpy).toHaveBeenCalledTimes(1);
      const [calledAdvice, requestedAmount] = createOrderSpy.mock.calls[0];
      expect(calledAdvice).toBe(advice);
      expect(requestedAmount).toBeCloseTo(9.5, 5);
    });

    it('delegates to createOrder for valid SELL advice using asset holdings', () => {
      trader['price'] = 100;
      trader['portfolio'] = { asset: 3, currency: 0 };
      const advice = buildAdvice({ order: { side: 'SELL', type: 'MARKET' } });
      const createOrderSpy = vi
        .spyOn(trader as unknown as { createOrder: (a: Advice, amount: number) => Promise<void> }, 'createOrder')
        .mockResolvedValue(undefined);

      trader.onStrategyCreateOrder(advice);

      expect(createOrderSpy).toHaveBeenCalledWith(advice, 3);
    });
  });

  describe('createOrder', () => {
    it('stores created order and emits initiation event', async () => {
      const advice = buildAdvice();
      trader['synchronize'] = vi.fn();

      await trader['createOrder'](advice, 2);

      expect((trader as any).orders).toHaveLength(1);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_INITIATED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          requestedAmount: 2,
          orderType: advice.order.type,
        }),
      );
    });

    it('handles ORDER_ERRORED_EVENT by emitting error and removing order', async () => {
      const advice = buildAdvice();
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);

      await trader['createOrder'](advice, 1);

      const order = (trader as any).orders[0];
      order.emit(ORDER_ERRORED_EVENT, 'boom');

      expect(logger.error).toHaveBeenCalledWith('trader', 'Gekko received error: boom');
      expect((trader as any).orders).toHaveLength(0);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          reason: 'boom',
          orderType: advice.order.type,
        }),
      );
      expect(synchronizeSpy).toHaveBeenCalled();
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

      await trader['createOrder'](advice, 1);
      const order = (trader as any).orders[0];

      trader.onStrategyCancelOrder(advice.id);

      expect(order.removeAllListeners).toHaveBeenCalled();
      expect(order.cancel).toHaveBeenCalled();

      order.emit(ORDER_COMPLETED_EVENT);
      await Promise.resolve();

      expect((trader as any).orders).toHaveLength(0);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_CANCELED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          orderType: advice.order.type,
        }),
      );
      expect(synchronizeSpy).toHaveBeenCalled();
    });
  });

  describe('handleOrderCompletedEvent', () => {
    it('throws error when order cannot be found', async () => {
      await expect(trader['handleOrderCompletedEvent'](buildAdvice(), 1)).rejects.toThrow(GekkoError);
    });

    it('removes order, synchronizes, and emits completion summary', async () => {
      const advice = buildAdvice();
      await trader['createOrder'](advice, 2);
      const order = (trader as any).orders[0];

      const summary = {
        amount: 2,
        price: 100,
        feePercent: 0.5,
        side: 'BUY',
        date: 1_700_000_111_000,
      };
      order.createSummary.mockResolvedValue(summary);

      const processCostSpy = vi
        .spyOn(traderUtils, 'processCostAndPrice')
        .mockReturnValue({ effectivePrice: 101, cost: 2 });
      const synchronizeSpy = vi
        .spyOn(trader as unknown as { synchronize: () => Promise<void> }, 'synchronize')
        .mockResolvedValue(undefined);

      trader['portfolio'] = { asset: 5, currency: 10 };
      trader['balance'] = 510;

      await trader['handleOrderCompletedEvent'](advice, 2);

      expect((trader as any).orders).toHaveLength(0);
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(processCostSpy).toHaveBeenCalledWith(summary.side, summary.price, summary.amount, summary.feePercent);
      expect(trader['deferredEmit']).toHaveBeenCalledWith(
        ORDER_COMPLETED_EVENT,
        expect.objectContaining({
          orderId: advice.id,
          side: summary.side,
          amount: summary.amount,
          price: summary.price,
          feePercent: summary.feePercent,
          effectivePrice: 101,
          cost: 2,
          orderType: advice.order.type,
          requestedAmount: 2,
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
      expect(trader['syncInterval']).toBeUndefined();
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
          ORDER_ABORTED_EVENT,
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
