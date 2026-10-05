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
import { BalanceDetail, Portfolio } from '@models/portfolio.types';
import { OrderSummary } from '@services/core/order/order.types';
import { noop } from 'lodash-es';
import type { Mock } from 'vitest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../services/configuration/configuration';
import * as logger from '../../services/logger';
import * as processUtils from '../../utils/process/process.utils';
import { Trader } from './trader';

vi.mock('@services/logger');

// launch(), cancel() and checkOrder() of every order mock: they resolve, unless a test makes them reject
const { orderActions } = vi.hoisted(() => ({
  orderActions: {
    launch: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    checkOrder: vi.fn(async () => undefined),
  },
}));

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

type OrderListener = (...args: unknown[]) => unknown;

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

// A promise settled by the test, for an exchange call still in flight while something else happens
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
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
    this.cancel = orderActions.cancel;
    this.launch = orderActions.launch;
    this.checkOrder = orderActions.checkOrder;
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
      return handler(...args);
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

  // Like emit, then resolves with how each listener settled. An EventEmitter ignores what its listeners return, so in the
  // application a listener promise that rejects is an unhandled rejection.
  MockOrder.prototype.emitAndSettle = function (event: string, ...args: unknown[]) {
    const handlers = Array.from(ensureStore(this).get(event) ?? []);
    return Promise.allSettled(handlers.map(listener => listener(...args)));
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
  const getCompletedEvent = () =>
    (trader['addDeferredEmit'] as unknown as Mock).mock.calls.find(call => call[0] === ORDER_COMPLETED_EVENT)?.[1];
  const getCanceledEvent = () =>
    (trader['addDeferredEmit'] as unknown as Mock).mock.calls.find(call => call[0] === ORDER_CANCELED_EVENT)?.[1];

  const buildAdvice = (overrides?: Partial<AdviceOrder>): AdviceOrder => ({
    id: overrides?.id ?? '20a7abd2-546b-4c65-b04d-900b84fa5fe6',
    orderCreationDate: overrides?.orderCreationDate ?? 1_700_000_000_100,
    type: overrides?.type ?? 'STICKY',
    side: overrides?.side ?? 'BUY',
    amount: overrides?.amount,
    price: overrides?.price,
    symbol: overrides?.symbol ?? 'BTC/USDT',
  });

  // An order created by the trader, listened to by its creation flow, or by its cancelation flow once canceled
  const prepareOrder = async (flow: 'creation' | 'cancelation', advice = buildAdvice()) => {
    await trader.onStrategyCreateOrder([advice]);
    const order = getOrderInstance(advice.id)!;
    if (flow === 'cancelation') await trader.onStrategyCancelOrder([advice.id]);
    return order;
  };

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
        const spy = vi.spyOn(trader as any, 'addDeferredEmit');
        await trader['synchronize']();
        expect(spy).toHaveBeenCalledWith(PORTFOLIO_CHANGE_EVENT, trader['portfolio']);
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
        const emitSpy = vi.spyOn(filteredTrader as any, 'addDeferredEmit');

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

    // One synchronization at a time: two in flight could end in any order, the older one overwriting what the newer one read
    describe('Overlapping calls', () => {
      it('fetches the balance once for two calls made while a synchronization is in flight', async () => {
        await Promise.all([trader['synchronize'](), trader['synchronize']()]);
        expect(fakeExchange.fetchBalance).toHaveBeenCalledOnce();
      });

      it('emits the portfolio once for two calls made while a synchronization is in flight', async () => {
        await Promise.all([trader['synchronize'](), trader['synchronize']()]);
        expect(trader['addDeferredEmit']).toHaveBeenCalledOnce();
      });

      it('shares the failure of the synchronization in flight with the call that joined it', async () => {
        fakeExchange.fetchBalance.mockRejectedValueOnce(new Error('network down'));
        const [, joined] = await Promise.allSettled([trader['synchronize'](), trader['synchronize']()]);
        expect(joined).toEqual({ status: 'rejected', reason: new Error('network down') });
      });

      it.each`
        outcome     | rejection
        ${'ended'}  | ${undefined}
        ${'failed'} | ${new Error('network down')}
      `('fetches the balance again for a call made once the synchronization has $outcome', async ({ rejection }) => {
        if (rejection) fakeExchange.fetchBalance.mockRejectedValueOnce(rejection);
        await trader['synchronize']().catch(noop);
        await trader['synchronize']();
        expect(fakeExchange.fetchBalance).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('processInit', () => {
    const exchangeSynchInterval = 60_000;

    beforeEach(() => {
      getExchangeMock.mockReturnValue({ name: 'binance', exchangeSynchInterval });
    });

    it('synchronizes at once', async () => {
      trader['processInit']();
      await tick();
      expect(fakeExchange.fetchBalance).toHaveBeenCalledOnce();
    });

    it('synchronizes again every exchangeSynchInterval in realtime', async () => {
      trader['processInit']();
      await vi.advanceTimersByTimeAsync(exchangeSynchInterval);
      expect(fakeExchange.fetchBalance).toHaveBeenCalledTimes(2);
    });

    it('does not synchronize periodically in backtest', async () => {
      (trader as any).mode = 'backtest';
      trader['processInit']();
      await vi.advanceTimersByTimeAsync(exchangeSynchInterval);
      expect(fakeExchange.fetchBalance).toHaveBeenCalledOnce();
    });

    it('stops the periodic synchronization once finalized', async () => {
      trader['processInit']();
      trader['processFinalize']();
      await vi.advanceTimersByTimeAsync(exchangeSynchInterval);
      expect(fakeExchange.fetchBalance).toHaveBeenCalledOnce();
    });

    // Neither is awaited: a rejection would be unhandled, and a failed synchronization is not fatal, the next one tries again
    it.each`
      synchronization | failingCall
      ${'first'}      | ${1}
      ${'periodic'}   | ${2}
    `('logs a $synchronization synchronization that fails instead of leaving the rejection unhandled', async ({ failingCall }) => {
      fakeExchange.fetchBalance.mockImplementation(async () => {
        if (fakeExchange.fetchBalance.mock.calls.length === failingCall) throw new Error('network down');
        return new Map();
      });
      trader['processInit']();
      await vi.advanceTimersByTimeAsync(exchangeSynchInterval);
      expect(logger.error).toHaveBeenCalledWith('trader', 'Impossible to synchronize: network down');
    });

    describe('when a periodic synchronization comes while one is in flight', () => {
      beforeEach(async () => {
        fakeExchange.fetchBalance.mockReturnValueOnce(new Promise(noop));
        trader['processInit']();
        await vi.advanceTimersByTimeAsync(exchangeSynchInterval);
      });

      it('skips it', () => {
        expect(fakeExchange.fetchBalance).toHaveBeenCalledOnce();
      });

      it('says so at debug level', () => {
        expect(logger.debug).toHaveBeenCalledWith('trader', 'Synchronization skipped: another one is in flight');
      });
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

    // In realtime an interval of each order runs its check. In backtest nothing does but the bucket, for the STICKY orders, which
    // move to follow the market: the simulated exchange settles LIMIT and MARKET orders through the callback of their creation.
    describe('order checks', () => {
      const ids = [
        '0f8f6f36-31c4-4c39-9a3b-7f9e0c1d2a01',
        '0f8f6f36-31c4-4c39-9a3b-7f9e0c1d2a02',
        '0f8f6f36-31c4-4c39-9a3b-7f9e0c1d2a03',
      ] as const;
      const bucket = new Map([['BTC/USDT', defaultCandle]]) as any;
      // A minute that is a multiple of 10, when the backtest synchronizes (see getBacktestModeIntervalSyncTime)
      const synchronizationBucket = new Map([['BTC/USDT', { ...defaultCandle, start: 1_700_000_400_000 }]]) as any;
      const getCheckedTypes = () => orderActions.checkOrder.mock.contexts.map(order => (order as any).getType());

      const createOrders = async (mode: 'backtest' | 'realtime', types: AdviceOrder['type'][]) => {
        (trader as any).mode = mode;
        await trader.onStrategyCreateOrder(types.map((type, index) => buildAdvice({ id: ids[index], type, amount: 1, price: 100 })));
      };

      it.each`
        mode          | types                            | checked
        ${'backtest'} | ${['STICKY', 'STICKY']}          | ${['STICKY', 'STICKY']}
        ${'backtest'} | ${['LIMIT', 'STICKY', 'MARKET']} | ${['STICKY']}
        ${'realtime'} | ${['STICKY', 'LIMIT', 'MARKET']} | ${[]}
      `('checks the $checked orders among the $types orders in flight in $mode', async ({ mode, types, checked }) => {
        await createOrders(mode, types);
        await trader['processOneMinuteBucket'](bucket);
        expect(getCheckedTypes()).toEqual(checked);
      });

      it('checks a STICKY order again at each bucket', async () => {
        await createOrders('backtest', ['STICKY']);
        await trader['processOneMinuteBucket'](bucket);
        await trader['processOneMinuteBucket'](bucket);
        expect(orderActions.checkOrder).toHaveBeenCalledTimes(2);
      });

      it('no longer checks an order once its end is reported', async () => {
        vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
        await createOrders('backtest', ['STICKY']);
        await getOrderInstance(ids[0]).emitAndSettle(ORDER_CANCELED_EVENT, { timestamp: 1_700_000_100_000, filled: 0, remaining: 1 });
        await trader['processOneMinuteBucket'](bucket);
        expect(orderActions.checkOrder).not.toHaveBeenCalled();
      });

      // The deferred events of the bucket are flushed once every plugin has processed it: a move must be over by then
      describe('while the check of an order is in flight', () => {
        let synchronizeSpy: ReturnType<typeof vi.spyOn>;
        let check: ReturnType<typeof deferred<undefined>>;
        let processed: Promise<void>;
        let isProcessed: boolean;

        beforeEach(async () => {
          synchronizeSpy = vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
          await createOrders('backtest', ['STICKY']);
          check = deferred<undefined>();
          orderActions.checkOrder.mockReturnValueOnce(check.promise);
          isProcessed = false;
          processed = trader['processOneMinuteBucket'](synchronizationBucket).then(() => {
            isProcessed = true;
          });
          await tick(10);
        });

        it('does not end the bucket yet', () => {
          expect(isProcessed).toBe(false);
        });

        it('does not synchronize yet', () => {
          expect(synchronizeSpy).not.toHaveBeenCalled();
        });

        it('synchronizes once it has ended', async () => {
          check.resolve(undefined);
          await processed;
          expect(synchronizeSpy).toHaveBeenCalledOnce();
        });
      });

      // A check reports its failures through the events of the order and never rejects: should it, the bucket goes on
      it.each`
        kind                   | rejection
        ${'an Error'}          | ${new Error('check exploded')}
        ${'a non-Error value'} | ${'check exploded'}
      `('logs a check rejecting with $kind', async ({ rejection }) => {
        await createOrders('backtest', ['STICKY']);
        orderActions.checkOrder.mockRejectedValueOnce(rejection);
        await trader['processOneMinuteBucket'](bucket);
        expect(logger.error).toHaveBeenCalledWith('trader', `[${ids[0]}] Impossible to check the BUY STICKY order: check exploded`);
      });

      it('ends the bucket when a check rejects', async () => {
        await createOrders('backtest', ['STICKY']);
        orderActions.checkOrder.mockRejectedValueOnce(new Error('check exploded'));
        await expect(trader['processOneMinuteBucket'](bucket)).resolves.toBeUndefined();
      });
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
      const completionSpy = vi.spyOn(trader as any, 'checkOrderSummary');

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      order.emit(ORDER_COMPLETED_EVENT);
      await tick(); // Extra tick for async summary creation

      expect(order.createSummary).toHaveBeenCalled();
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(completionSpy).toHaveBeenCalledWith(expect.objectContaining({ id: advice.id }));
      expect(getOrdersMap().size).toBe(0);
    });

    it('emits ORDER_COMPLETED_EVENT with the portfolio fetched after the fill', async () => {
      const portfolioAfterFill = new Map<string, BalanceDetail>([
        ['BTC', { free: 12.5, used: 0, total: 12.5 }],
        ['USDT', { free: 50, used: 0, total: 50 }],
      ]);
      fakeExchange.fetchBalance.mockResolvedValue(portfolioAfterFill);
      const advice = buildAdvice();

      await trader.onStrategyCreateOrder([advice]);
      getOrderInstance(advice.id)!.emit(ORDER_COMPLETED_EVENT);
      await tick(10); // createSummary, then synchronize (fetchBalance, fetchTickers)

      expect(getCompletedEvent()?.exchange.portfolio).toEqual(portfolioAfterFill);
    });

    // Expired, or canceled from the interface of the exchange: the strategy did not ask for it, but waits for the end of the order
    describe('when the exchange cancels an order', () => {
      const advice = buildAdvice();

      beforeEach(async () => {
        vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
        await trader.onStrategyCreateOrder([advice]);
        const order = getOrderInstance(advice.id)!;
        await order.emitAndSettle(ORDER_CANCELED_EVENT, { status: 'canceled', timestamp: 123_456, filled: 2, remaining: 7.5 });
      });

      it('emits a deferred ORDER_CANCELED_EVENT with what the order filled', () => {
        expect(trader['addDeferredEmit']).toHaveBeenCalledWith(ORDER_CANCELED_EVENT, {
          order: expect.objectContaining({ id: advice.id, orderCancelationDate: 123_456, filled: 2, remaining: 7.5 }),
          exchange: { price: 100, portfolio: trader['portfolio'] },
        });
      });

      it('synchronizes before emitting it', () => {
        expect(trader['synchronize']).toHaveBeenCalledOnce();
      });

      it('forgets the order', () => {
        expect(getOrdersMap().has(advice.id)).toBe(false);
      });

      it('warns when the strategy cancels the order afterwards', async () => {
        await trader.onStrategyCancelOrder([advice.id]);
        expect(logger.warning).toHaveBeenCalledWith('trader', `[${advice.id}] Impossible to cancel order: Unknown Order`);
      });
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

    it.each`
      kind                   | rejection
      ${'an Error'}          | ${new Error('exchange exploded')}
      ${'a non-Error value'} | ${'exchange exploded'}
    `('logs a launch rejecting with $kind instead of leaving the rejection unhandled', async ({ rejection }) => {
      orderActions.launch.mockRejectedValueOnce(rejection);

      await trader.onStrategyCreateOrder([buildAdvice()]);
      await tick();

      expect(logger.error).toHaveBeenCalledWith(
        'trader',
        expect.stringContaining('Impossible to launch the BUY STICKY order: exchange exploded'),
      );
    });
  });

  describe('onStrategyCancelOrder', () => {
    it('warns when order is unknown', async () => {
      await trader.onStrategyCancelOrder(['missing-id' as any]);
      expect(logger.warning).toHaveBeenCalledWith('trader', '[missing-id] Impossible to cancel order: Unknown Order');
    });

    it('cancels an order once when its id comes twice in the same batch', async () => {
      const advice = buildAdvice();
      trader['prices'].set('BTC/USDT', 100);
      await trader.onStrategyCreateOrder([advice]);

      await trader.onStrategyCancelOrder([advice.id, advice.id]);

      expect(orderActions.cancel).toHaveBeenCalledOnce();
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
      const completionSpy = vi.spyOn(trader as any, 'checkOrderSummary');
      trader['prices'].set('BTC/USDT', 100);

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;

      await trader.onStrategyCancelOrder([advice.id]);

      // Simulate completed instead of canceled
      await order.emitAndSettle(ORDER_COMPLETED_EVENT);

      expect(completionSpy).toHaveBeenCalled();
      expect(getOrdersMap().size).toBe(0);
    });

    it('emits ORDER_COMPLETED_EVENT with the portfolio fetched after a fill that beat the cancel', async () => {
      const portfolioAfterFill = new Map<string, BalanceDetail>([
        ['BTC', { free: 9.5, used: 0, total: 9.5 }],
        ['USDT', { free: 50, used: 0, total: 50 }],
      ]);
      fakeExchange.fetchBalance.mockResolvedValue(portfolioAfterFill);
      trader['prices'].set('BTC/USDT', 100);
      const advice = buildAdvice();

      await trader.onStrategyCreateOrder([advice]);
      const order = getOrderInstance(advice.id)!;
      await trader.onStrategyCancelOrder([advice.id]);
      order.emit(ORDER_COMPLETED_EVENT);
      await tick(10); // createSummary, then synchronize (fetchBalance, fetchTickers)

      expect(getCompletedEvent()?.exchange.portfolio).toEqual(portfolioAfterFill);
    });

    // A cancelation asked while the order is created is sent once it has an id, and the exchange may refuse the creation first
    it('relays the refusal of the creation of an order being canceled as an ORDER_ERRORED_EVENT', async () => {
      vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
      trader['prices'].set('BTC/USDT', 100);
      const order = await prepareOrder('cancelation');

      await order.emitAndSettle(ORDER_INVALID_EVENT, { reason: 'too small', status: 'rejected', filled: false });

      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(ORDER_ERRORED_EVENT, {
        order: expect.objectContaining({ id: buildAdvice().id, reason: 'too small', orderErrorDate: 1_700_000_000_000 }),
        exchange: { price: 100, portfolio: trader['portfolio'] },
      });
    });

    it('logs a cancel that rejects instead of leaving the rejection unhandled', async () => {
      const advice = buildAdvice();
      trader['prices'].set('BTC/USDT', 100);
      await trader.onStrategyCreateOrder([advice]);
      orderActions.cancel.mockRejectedValueOnce(new Error('cancel exploded'));

      await trader.onStrategyCancelOrder([advice.id]);
      await tick();

      expect(logger.error).toHaveBeenCalledWith(
        'trader',
        expect.stringContaining('Impossible to cancel the BUY STICKY order: cancel exploded'),
      );
    });
  });

  describe('order listener failures', () => {
    beforeEach(() => {
      trader['prices'].set('BTC/USDT', 100);
    });

    // Every terminal event is listened to in both flows. The synchronization is best effort: the strategy waits for the event.
    describe.each`
      flow             | event                    | payload                                                        | relayed
      ${'creation'}    | ${ORDER_INVALID_EVENT}   | ${{ reason: 'too small', status: 'rejected', filled: false }}  | ${ORDER_ERRORED_EVENT}
      ${'creation'}    | ${ORDER_ERRORED_EVENT}   | ${'exchange timeout'}                                          | ${ORDER_ERRORED_EVENT}
      ${'creation'}    | ${ORDER_COMPLETED_EVENT} | ${undefined}                                                   | ${ORDER_COMPLETED_EVENT}
      ${'creation'}    | ${ORDER_CANCELED_EVENT}  | ${{ timestamp: 1_700_000_100_000, filled: 0, remaining: 9.5 }} | ${ORDER_CANCELED_EVENT}
      ${'cancelation'} | ${ORDER_INVALID_EVENT}   | ${{ reason: 'too small', status: 'rejected', filled: false }}  | ${ORDER_ERRORED_EVENT}
      ${'cancelation'} | ${ORDER_ERRORED_EVENT}   | ${'exchange timeout'}                                          | ${ORDER_ERRORED_EVENT}
      ${'cancelation'} | ${ORDER_COMPLETED_EVENT} | ${undefined}                                                   | ${ORDER_COMPLETED_EVENT}
      ${'cancelation'} | ${ORDER_CANCELED_EVENT}  | ${{ timestamp: 1_700_000_100_000, filled: 0, remaining: 9.5 }} | ${ORDER_CANCELED_EVENT}
    `('when the synchronization fails in the $event listener of the $flow flow', ({ flow, event, payload, relayed }) => {
      const advice = buildAdvice();
      let settled: PromiseSettledResult<unknown>[];

      beforeEach(async () => {
        vi.spyOn(trader as any, 'synchronize').mockRejectedValue(new Error('network down'));
        const order = await prepareOrder(flow, advice);
        settled = await order.emitAndSettle(event, payload);
      });

      it('settles the listener instead of rejecting', () => {
        expect(settled).toEqual([{ status: 'fulfilled', value: undefined }]);
      });

      it('logs the failure', () => {
        expect(logger.error).toHaveBeenCalledWith('trader', `[${advice.id}] Impossible to synchronize: network down`);
      });

      it(`still emits the deferred ${relayed}, with the portfolio known`, () => {
        expect(trader['addDeferredEmit']).toHaveBeenCalledWith(relayed, {
          order: expect.objectContaining({ id: advice.id }),
          exchange: { price: 100, portfolio: trader['portfolio'] },
        });
      });
    });

    // What is left to fail once the synchronization is best effort: queuing the event (structuredClone)
    describe.each`
      event                    | payload                                                        | report
      ${ORDER_INVALID_EVENT}   | ${{ reason: 'too small', status: 'rejected', filled: false }}  | ${'rejection'}
      ${ORDER_ERRORED_EVENT}   | ${'exchange timeout'}                                          | ${'error'}
      ${ORDER_COMPLETED_EVENT} | ${undefined}                                                   | ${'completion'}
      ${ORDER_CANCELED_EVENT}  | ${{ timestamp: 1_700_000_100_000, filled: 0, remaining: 9.5 }} | ${'cancelation'}
    `('when the $event of an order cannot be relayed', ({ event, payload, report }) => {
      let settled: PromiseSettledResult<unknown>[];

      beforeEach(async () => {
        vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
        const order = await prepareOrder('creation');
        (trader['addDeferredEmit'] as unknown as Mock).mockImplementation(() => {
          throw new Error('payload not cloneable');
        });
        settled = await order.emitAndSettle(event, payload);
      });

      it('settles the listener instead of rejecting', () => {
        expect(settled).toEqual([{ status: 'fulfilled', value: undefined }]);
      });

      it('logs the failure', () => {
        expect(logger.error).toHaveBeenCalledWith(
          'trader',
          expect.stringContaining(`Impossible to report the ${report} of the BUY STICKY order: payload not cloneable`),
        );
      });
    });

    describe.each`
      flow
      ${'creation'}
      ${'cancelation'}
    `('when the summary of an order completed in the $flow flow cannot be created', ({ flow }) => {
      const advice = buildAdvice();
      let settled: PromiseSettledResult<unknown>[];

      beforeEach(async () => {
        vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
        const order = await prepareOrder(flow, advice);
        order.createSummary.mockRejectedValue(new Error('fetchMyTrades failed'));
        settled = await order.emitAndSettle(ORDER_COMPLETED_EVENT);
      });

      it('settles the listener instead of rejecting', () => {
        expect(settled).toEqual([{ status: 'fulfilled', value: undefined }]);
      });

      it('logs the failure', () => {
        expect(logger.error).toHaveBeenCalledWith(
          'trader',
          expect.stringContaining('its summary could not be created: fetchMyTrades failed'),
        );
      });

      it('forgets the order', () => {
        expect(getOrdersMap().has(advice.id)).toBe(false);
      });

      it('emits a deferred ORDER_ERRORED_EVENT whose reason is the error message', () => {
        expect(trader['addDeferredEmit']).toHaveBeenCalledWith(ORDER_ERRORED_EVENT, {
          order: expect.objectContaining({ id: advice.id, reason: 'fetchMyTrades failed', orderErrorDate: 1_700_000_000_000 }),
          exchange: { price: 100, portfolio: trader['portfolio'] },
        });
      });

      it('emits no ORDER_COMPLETED_EVENT', () => {
        expect(getCompletedEvent()).toBeUndefined();
      });
    });

    describe.each`
      flow
      ${'creation'}
      ${'cancelation'}
    `('when neither the summary nor the synchronization succeed for an order completed in the $flow flow', ({ flow }) => {
      beforeEach(async () => {
        vi.spyOn(trader as any, 'synchronize').mockRejectedValue(new Error('network down'));
        const order = await prepareOrder(flow);
        order.createSummary.mockRejectedValue(new Error('fetchMyTrades failed'));
        await order.emitAndSettle(ORDER_COMPLETED_EVENT);
      });

      it('still emits a deferred ORDER_ERRORED_EVENT', () => {
        expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
          ORDER_ERRORED_EVENT,
          expect.objectContaining({ order: expect.objectContaining({ reason: 'fetchMyTrades failed' }) }),
        );
      });

      it('logs the synchronization failure', () => {
        expect(logger.error).toHaveBeenCalledWith('trader', expect.stringContaining('Impossible to synchronize: network down'));
      });
    });

    it('reports a price of 0 in the ORDER_ERRORED_EVENT of an unsummarized order when the price of its pair is unknown', async () => {
      vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
      const order = await prepareOrder('creation');
      order.createSummary.mockRejectedValue(new Error('fetchMyTrades failed'));
      trader['prices'].clear();

      await order.emitAndSettle(ORDER_COMPLETED_EVENT);

      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_ERRORED_EVENT,
        expect.objectContaining({ exchange: { price: 0, portfolio: trader['portfolio'] } }),
      );
    });

    it('reports a price of 0 in the ORDER_CANCELED_EVENT of an order when the price of its pair is unknown', async () => {
      vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
      const order = await prepareOrder('creation');
      trader['prices'].clear();

      await order.emitAndSettle(ORDER_CANCELED_EVENT, { timestamp: 1_700_000_100_000, filled: 0, remaining: 9.5 });

      expect(trader['addDeferredEmit']).toHaveBeenCalledWith(
        ORDER_CANCELED_EVENT,
        expect.objectContaining({ exchange: { price: 0, portfolio: trader['portfolio'] } }),
      );
    });
  });

  // An order that ended filled or canceled changed the portfolio (a fill, the release of what it reserved): its event needs a
  // synchronization started after its end. An error or a refusal changed nothing: any synchronization will do.
  describe('synchronization after the end of an order', () => {
    const portfolioBefore = new Map<string, BalanceDetail>([['USDT', { free: 50, used: 950, total: 1000 }]]);
    const portfolioAfter = new Map<string, BalanceDetail>([['USDT', { free: 1000, used: 0, total: 1000 }]]);

    beforeEach(() => {
      trader['prices'].set('BTC/USDT', 100);
    });

    describe('when a synchronization started before the cancelation of an order is in flight', () => {
      beforeEach(async () => {
        const order = await prepareOrder('cancelation');
        const balance = deferred<Portfolio>();
        fakeExchange.fetchBalance.mockReturnValueOnce(balance.promise).mockResolvedValueOnce(portfolioAfter);
        const inFlight = trader['synchronize']();
        const reported = order.emitAndSettle(ORDER_CANCELED_EVENT, { timestamp: 1_700_000_100_000, filled: 0, remaining: 9.5 });
        balance.resolve(portfolioBefore);
        await Promise.all([inFlight, reported]);
      });

      it('waits for it to end, then fetches the balance again', () => {
        expect(fakeExchange.fetchBalance).toHaveBeenCalledTimes(2);
      });

      it('emits the ORDER_CANCELED_EVENT with the portfolio fetched after the cancelation', () => {
        expect(getCanceledEvent()?.exchange.portfolio).toEqual(portfolioAfter);
      });
    });

    describe('when a synchronization starts between the fill of an order and its report', () => {
      beforeEach(async () => {
        const order = await prepareOrder('creation');
        const balance = deferred<Portfolio>();
        fakeExchange.fetchBalance.mockReturnValueOnce(balance.promise);
        const reported = order.emitAndSettle(ORDER_COMPLETED_EVENT); // The report summarizes the order first
        const started = trader['synchronize']();
        await tick(10);
        balance.resolve(portfolioAfter);
        await Promise.all([started, reported]);
      });

      it('joins it', () => {
        expect(fakeExchange.fetchBalance).toHaveBeenCalledOnce();
      });

      it('emits the ORDER_COMPLETED_EVENT with the portfolio it fetched', () => {
        expect(getCompletedEvent()?.exchange.portfolio).toEqual(portfolioAfter);
      });
    });

    it.each`
      event                  | payload
      ${ORDER_ERRORED_EVENT} | ${'exchange timeout'}
      ${ORDER_INVALID_EVENT} | ${{ reason: 'too small', status: 'rejected', filled: false }}
    `('joins the synchronization in flight to relay $event', async ({ event, payload }) => {
      const order = await prepareOrder('creation');
      const balance = deferred<Portfolio>();
      fakeExchange.fetchBalance.mockReturnValueOnce(balance.promise);
      const inFlight = trader['synchronize']();
      const reported = order.emitAndSettle(event, payload);
      balance.resolve(portfolioBefore);
      await Promise.all([inFlight, reported]);

      expect(fakeExchange.fetchBalance).toHaveBeenCalledOnce();
    });
  });

  // The first terminal event of an order removes all its listeners: a later one, a fill after an error or an error repeated at every
  // check, is never relayed, and the strategy hears once of each order
  describe('late events of an order already over', () => {
    const payloads: Record<string, unknown> = {
      [ORDER_INVALID_EVENT]: { reason: 'too small', status: 'rejected', filled: false },
      [ORDER_ERRORED_EVENT]: 'exchange timeout',
      [ORDER_COMPLETED_EVENT]: undefined,
      [ORDER_CANCELED_EVENT]: { timestamp: 1_700_000_100_000, filled: 0, remaining: 9.5 },
    };
    const relayedEvents = [ORDER_CANCELED_EVENT, ORDER_COMPLETED_EVENT, ORDER_ERRORED_EVENT];
    const getRelayedEvents = () =>
      (trader['addDeferredEmit'] as unknown as Mock).mock.calls.map(([event]) => event).filter(event => relayedEvents.includes(event));

    beforeEach(() => {
      trader['prices'].set('BTC/USDT', 100);
      vi.spyOn(trader as any, 'synchronize').mockResolvedValue(undefined);
    });

    it.each`
      flow             | first                    | late                     | relayed
      ${'creation'}    | ${ORDER_ERRORED_EVENT}   | ${ORDER_COMPLETED_EVENT} | ${[ORDER_ERRORED_EVENT]}
      ${'creation'}    | ${ORDER_ERRORED_EVENT}   | ${ORDER_ERRORED_EVENT}   | ${[ORDER_ERRORED_EVENT]}
      ${'creation'}    | ${ORDER_INVALID_EVENT}   | ${ORDER_COMPLETED_EVENT} | ${[ORDER_ERRORED_EVENT]}
      ${'creation'}    | ${ORDER_COMPLETED_EVENT} | ${ORDER_ERRORED_EVENT}   | ${[ORDER_COMPLETED_EVENT]}
      ${'creation'}    | ${ORDER_COMPLETED_EVENT} | ${ORDER_INVALID_EVENT}   | ${[ORDER_COMPLETED_EVENT]}
      ${'creation'}    | ${ORDER_COMPLETED_EVENT} | ${ORDER_CANCELED_EVENT}  | ${[ORDER_COMPLETED_EVENT]}
      ${'creation'}    | ${ORDER_CANCELED_EVENT}  | ${ORDER_COMPLETED_EVENT} | ${[ORDER_CANCELED_EVENT]}
      ${'cancelation'} | ${ORDER_COMPLETED_EVENT} | ${ORDER_CANCELED_EVENT}  | ${[ORDER_COMPLETED_EVENT]}
      ${'cancelation'} | ${ORDER_ERRORED_EVENT}   | ${ORDER_COMPLETED_EVENT} | ${[ORDER_ERRORED_EVENT]}
      ${'cancelation'} | ${ORDER_CANCELED_EVENT}  | ${ORDER_ERRORED_EVENT}   | ${[ORDER_CANCELED_EVENT]}
      ${'cancelation'} | ${ORDER_INVALID_EVENT}   | ${ORDER_COMPLETED_EVENT} | ${[ORDER_ERRORED_EVENT]}
    `('relays $relayed only when an order of the $flow flow emits $late after $first', async ({ flow, first, late, relayed }) => {
      const order = await prepareOrder(flow);

      await order.emitAndSettle(first, payloads[first]);
      await order.emitAndSettle(late, payloads[late]);

      expect(getRelayedEvents()).toEqual(relayed);
    });

    it('stops logging the updates of an order once it is over', async () => {
      const order = await prepareOrder('creation');
      await order.emitAndSettle(ORDER_ERRORED_EVENT, 'exchange timeout');
      (logger.info as Mock).mockClear();

      order.emit(ORDER_STATUS_CHANGED_EVENT, { status: 'filled' });

      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('checkOrderSummary', () => {
    it('returns completion summary with computed pricing', () => {
      const summary: OrderSummary = {
        amount: 2,
        price: 100,
        feePercent: 0.5,
        side: 'BUY',
        orderExecutionDate: 1_700_000_111_000,
      };

      trader['prices'].set('BTC/USDT', 100);

      const result = trader['checkOrderSummary']({
        id: '20a7abd2-546b-4c65-b04d-900b84fa5fe6',
        symbol: 'BTC/USDT',
        type: 'STICKY',
        orderCreationDate: 1_700_000_051_000,
        summary,
      });

      // fee = 2 * 100 * 0.5% = 1
      // effective price = 100 + 100 * 0.5% = 100.5

      expect(result).toEqual({
        order: {
          ...summary,
          id: '20a7abd2-546b-4c65-b04d-900b84fa5fe6',
          symbol: 'BTC/USDT',
          type: 'STICKY',
          orderCreationDate: 1_700_000_051_000,
          fee: 1,
          effectivePrice: 100.5,
        },
        exchange: {
          price: 100,
          portfolio: trader['portfolio'],
        },
      });
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
