process.env.GEKKO_CONFIG_FILE_PATH = 'test';

import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TIMEFRAME_CANDLE_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { AdviceOrder } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { CandleBucket, OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { BalanceDetail } from '@models/portfolio.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Exchange, MarketData } from '@services/exchange/exchange.types';
import { StrategyManager } from '@strategies/strategyManager';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';
import { TradingAdvisor } from './tradingAdvisor';
import { TradingAdvisorConfiguration } from './tradingAdvisor.types';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const attachMockExchange = (instance: TradingAdvisor) => {
  instance.setExchange({
    getExchangeName: (): string => 'binance',
    getMarketData: (): MarketData => ({ amount: { min: 3 } }),
    fetchBalance: () =>
      new Map<string, BalanceDetail>([
        ['asset', { free: 100, used: 0, total: 100 }],
        ['currency', { free: 100, used: 0, total: 100 }],
      ]),
  } as unknown as Exchange);
};

vi.mock('@strategies/index', () => ({
  DummyStrategy: class {
    init = vi.fn();
    onNewCandle = vi.fn();
    onOrderCanceled = vi.fn();
    onOrderCompleted = vi.fn();
    onOrderErrored = vi.fn();
    onPortfolioChange = vi.fn();
    setUpMarketLimits = vi.fn();
    finish = vi.fn();
    on() {
      return this;
    }
  },
  NonExistentStrategy: undefined,
}));

vi.mock('@strategies/strategyManager', () => {
  return {
    StrategyManager: class {
      constructor() {}
      onOneMinuteBucket() {}
      createStrategy() {}
      setMarketData() {}
      onPortfolioChange() {}
      setCurrentTimestamp() {}
      onTimeFrameCandle() {}
      onStrategyEnd() {}
      onOrderCompleted() {}
      onOrderCanceled() {}
      onOrderErrored() {}
      on() {
        return this;
      }
    },
  };
});

vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(function () {
    return {
      getWatch: vi.fn(() => ({
        pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }],
        warmup: {},
      })),
      getStrategy: vi.fn(() => ({})),
      showLogo: vi.fn(),
      getPlugins: vi.fn(),
      getStorage: vi.fn(),
      getExchange: vi.fn(),
    };
  });
  return { config: new Configuration() };
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TradingAdvisor', () => {
  const config = {
    name: 'TradingAdvisor',
    strategyName: 'DummyStrategy',
    maxConsecutiveErrors: 5,
  } satisfies TradingAdvisorConfiguration;

  const defaultAdvice: AdviceOrder = {
    id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
    orderCreationDate: toTimestamp('2020'),
    type: 'STICKY',
    side: 'SELL',
    amount: 1,
    symbol: 'BTC/USDT',
  };

  const defaultCandle: Candle = {
    id: undefined,
    close: 100,
    high: 150,
    low: 90,
    open: 110,
    start: toTimestamp('2025'),
    volume: 10,
  };

  const defaultBuyTradeEvent: OrderCompletedEvent = {
    order: {
      id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
      side: 'BUY',
      type: 'STICKY',
      amount: 30,
      price: 100,
      orderCreationDate: 0,
      orderExecutionDate: 0,
      fee: 1,
      feePercent: 0.33,
      effectivePrice: 31,
      symbol: 'BTC/USDT',
    },
    exchange: {
      portfolio: new Map<string, BalanceDetail>([
        ['asset', { free: 100, used: 0, total: 100 }],
        ['currency', { free: 200, used: 0, total: 200 }],
      ]),
      price: 100,
    },
  };

  const defaultCanceledOrder: OrderCanceledEvent = {
    order: {
      id: '91f8d591-1a72-4d26-9477-5455e8d88111',
      orderCreationDate: 0,
      orderCancelationDate: 0,
      type: 'STICKY',
      side: 'BUY',
      amount: 5,
      filled: 2,
      remaining: 3,
      symbol: 'BTC/USDT',
    },
    exchange: {
      price: 100,
      portfolio: new Map<string, BalanceDetail>([
        ['asset', { free: 50, used: 0, total: 50 }],
        ['currency', { free: 500, used: 0, total: 500 }],
      ]),
    },
  };

  const defaultErroredOrder: OrderErroredEvent = {
    order: {
      id: defaultCanceledOrder.order.id,
      orderCreationDate: 0,
      orderErrorDate: 0,
      type: 'STICKY',
      side: 'BUY',
      reason: 'Order errored',
      amount: 2,
      symbol: 'BTC/USDT',
    },
    exchange: defaultCanceledOrder.exchange,
  };

  let advisor: TradingAdvisor;

  beforeEach(() => {
    advisor = new TradingAdvisor(config);
    attachMockExchange(advisor);
    (advisor as any).addDeferredEmit = vi.fn();
  });

  describe('life cycle functions', () => {
    describe('processInit', () => {
      it('should throw StrategyNotFoundError if an invalid strategy name is provided', async () => {
        const badAdvisor = new TradingAdvisor({
          name: 'TradingAdvisor',
          strategyName: 'NonExistentStrategy',
          maxConsecutiveErrors: 5,
        });
        attachMockExchange(badAdvisor);

        vi.spyOn(StrategyManager.prototype, 'createStrategy').mockRejectedValue(new GekkoError('configuration', 'Strategy not found'));

        await expect(() => (badAdvisor as any).processInit()).rejects.toThrowError(GekkoError);
      });

      it('should create a strategy manager when a valid strategy name is provided', async () => {
        await (advisor as any).processInit();
        expect((advisor as any).strategyManager).toBeDefined();
      });

      it('should set up market limits in strategy manager', async () => {
        const setUpSpy = vi.spyOn(StrategyManager.prototype, 'setMarketData');
        const expectedMap = new Map([['BTC/USDT', { amount: { min: 3 } }]]);

        await (advisor as any).processInit();

        expect(setUpSpy).toHaveBeenCalledExactlyOnceWith(expectedMap);
        setUpSpy.mockRestore();
      });
    });

    describe('processOneMinuteBucket', () => {
      beforeEach(async () => {
        await (advisor as any).processInit();
      });

      it('should pass bucket to the bucketBatcher', () => {
        const addBucketSpy = vi.spyOn((advisor as any).bucketBatcher, 'addBucket').mockReturnValue(undefined);
        const bucket: CandleBucket = new Map([['BTC/USDT', defaultCandle]]);

        (advisor as any).processOneMinuteBucket(bucket);

        expect(addBucketSpy).toHaveBeenCalledWith(bucket);
      });

      it('should not emit timeframe candle event when addBucket returns undefined', () => {
        vi.spyOn((advisor as any).bucketBatcher, 'addBucket').mockReturnValue(undefined);
        const bucket: CandleBucket = new Map([['BTC/USDT', defaultCandle]]);

        (advisor as any).processOneMinuteBucket(bucket);

        expect((advisor as any).addDeferredEmit).not.toHaveBeenCalled();
      });

      it('should emit TIMEFRAME_CANDLE_EVENT when addBucket returns a completed bucket', () => {
        const completedBucket = new Map([['BTC/USDT', defaultCandle]]);
        vi.spyOn((advisor as any).bucketBatcher, 'addBucket').mockReturnValue(completedBucket);
        const bucket: CandleBucket = new Map([['BTC/USDT', defaultCandle]]);

        (advisor as any).processOneMinuteBucket(bucket);

        expect((advisor as any).addDeferredEmit).toHaveBeenCalledExactlyOnceWith(TIMEFRAME_CANDLE_EVENT, completedBucket);
      });
    });

    describe('processFinalize', () => {
      beforeEach(async () => {
        await (advisor as any).processInit();
      });

      it('should call strategyManager.finish when processFinalize is called', () => {
        (advisor as any).strategyManager!.onStrategyEnd = vi.fn();
        (advisor as any).processFinalize();
        expect((advisor as any).strategyManager?.onStrategyEnd).toHaveBeenCalled();
      });
    });
  });

  describe('relay functions', () => {
    beforeEach(async () => {
      await (advisor as any).processInit();
    });

    it('relayStrategyWarmupCompleted emits STRATEGY_WARMUP_COMPLETED_EVENT', () => {
      const payload = new Map([['BTC/USDT', defaultCandle]]);
      (advisor as any).relayStrategyWarmupCompleted(payload);
      expect((advisor as any).addDeferredEmit).toHaveBeenCalledExactlyOnceWith(STRATEGY_WARMUP_COMPLETED_EVENT, payload);
    });

    it('relayCreateOrder emits STRATEGY_CREATE_ORDER_EVENT', () => {
      (advisor as any).relayCreateOrder(defaultAdvice);
      expect((advisor as any).addDeferredEmit).toHaveBeenCalledExactlyOnceWith(STRATEGY_CREATE_ORDER_EVENT, defaultAdvice);
    });

    it('relayStrategyInfo emits STRATEGY_INFO_EVENT', () => {
      const strategyInfoPayload: StrategyInfo = {
        level: 'debug',
        message: 'Hello World !',
        tag: 'strategy',
        timestamp: 123456789,
      };
      (advisor as any).relayStrategyInfo(strategyInfoPayload);
      expect((advisor as any).addDeferredEmit).toHaveBeenCalledExactlyOnceWith(STRATEGY_INFO_EVENT, strategyInfoPayload);
    });

    describe('relayCancelOrder', () => {
      it('should emit STRATEGY_CANCEL_ORDER_EVENT', () => {
        (advisor as any).relayCancelOrder(defaultCanceledOrder.order.id);
        expect((advisor as any).addDeferredEmit).toHaveBeenCalledExactlyOnceWith(
          STRATEGY_CANCEL_ORDER_EVENT,
          defaultCanceledOrder.order.id,
        );
      });
    });
  });

  describe('listeners functions', () => {
    beforeEach(async () => {
      await (advisor as any).processInit();
      // Ensure strategyManager methods are mocks
      if ((advisor as any).strategyManager) {
        (advisor as any).strategyManager.onOrderCompleted = vi.fn();
        (advisor as any).strategyManager.onOrderCanceled = vi.fn();
        (advisor as any).strategyManager.onOrderErrored = vi.fn();
        (advisor as any).strategyManager.onPortfolioChange = vi.fn();
      }
    });

    it.each([
      {
        method: 'onOrderCompleted',
        payload: [defaultBuyTradeEvent],
        managerMethod: 'onOrderCompleted',
        expectedArg: defaultBuyTradeEvent,
      },
      {
        method: 'onOrderCanceled',
        payload: [defaultCanceledOrder],
        managerMethod: 'onOrderCanceled',
        expectedArg: defaultCanceledOrder,
      },
      {
        method: 'onOrderErrored',
        payload: [defaultErroredOrder],
        managerMethod: 'onOrderErrored',
        expectedArg: defaultErroredOrder,
      },
    ])('calls strategyManager.$managerMethod when $method is called', async ({ method, payload, managerMethod, expectedArg }) => {
      await (advisor as any)[method](payload);

      expect((advisor as any).strategyManager[managerMethod]).toHaveBeenCalledExactlyOnceWith(expectedArg);
    });

    describe('onPortfolioChange', () => {
      it('should forward latest portfolio to the strategy manager', () => {
        const portfolio = new Map<string, BalanceDetail>([
          ['asset', { free: 5, used: 0, total: 5 }],
          ['currency', { free: 10, used: 0, total: 10 }],
        ]);

        advisor.onPortfolioChange([portfolio]);

        expect((advisor as any).strategyManager?.onPortfolioChange).toHaveBeenCalledExactlyOnceWith(portfolio);
      });
    });
  });
});
