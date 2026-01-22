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
import { OrderCanceledEvent, OrderCompletedEvent, OrderErroredEvent } from '@models/event.types';
import { BalanceDetail } from '@models/portfolio.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { Exchange, MarketData } from '@services/exchange/exchange.types';
import { StrategyManager } from '@strategies/strategyManager';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';
import { TradingAdvisor } from './tradingAdvisor';
import { TradingAdvisorConfiguration } from './tradingAdvisor.types';

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

describe('TradingAdvisor', () => {
  const config = {
    name: 'TradingAdvisor',
    strategyName: 'DummyStrategy',
  } satisfies TradingAdvisorConfiguration;
  const defaultAdvice: AdviceOrder = {
    id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
    orderCreationDate: toTimestamp('2020'),
    type: 'STICKY',
    side: 'SELL',
    amount: 1,
  };
  const defaultCandle: Candle = { close: 100, high: 150, low: 90, open: 110, start: toTimestamp('2025'), volume: 10 };
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
    },
    exchange: {
      portfolio: new Map<string, BalanceDetail>([
        ['asset', { free: 100, used: 0, total: 100 }],
        ['currency', { free: 200, used: 0, total: 200 }],
      ]),
      balance: { free: 1000, used: 0, total: 1000 },
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
    },
    exchange: {
      price: 100,
      balance: { free: 1000, used: 0, total: 1000 },
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
    },
    exchange: defaultCanceledOrder.exchange,
  };

  let advisor: TradingAdvisor;

  beforeEach(() => {
    advisor = new TradingAdvisor(config);
    attachMockExchange(advisor);
    advisor['addDeferredEmit'] = vi.fn();
  });

  describe('life cycle functions', () => {
    describe('processInit', () => {
      it('should throw StrategyNotFoundError if an invalid strategy name is provided', async () => {
        const badAdvisor = new TradingAdvisor({
          name: 'TradingAdvisor',
          strategyName: 'NonExistentStrategy',
        });
        attachMockExchange(badAdvisor);
        await expect(() => badAdvisor['processInit']()).rejects.toThrowError(GekkoError);
      });
      it('should create a strategy manager when a valid strategy name is provided', async () => {
        await advisor['processInit']();
        expect(advisor['strategyManager']).toBeDefined();
      });
      it('should set up market limits in strategy manager', async () => {
        const setUpSpy = vi.spyOn(StrategyManager.prototype, 'setMarketData');
        await advisor['processInit']();
        expect(setUpSpy).toHaveBeenCalledExactlyOnceWith({ amount: { min: 3 } });
        setUpSpy.mockRestore();
      });
    });

    describe('processOneMinuteCandle', () => {
      beforeEach(async () => {
        await advisor['processInit']();
      });
      it('should update the candle property when processOneMinuteCandle is called', () => {
        advisor['processOneMinuteCandle'](defaultCandle);
        expect(advisor['candle']).toEqual(defaultCandle);
      });

      it('should pass received candle to the candle batcher', () => {
        const addSpy = vi.spyOn(advisor['candleBatcher'], 'addSmallCandle').mockReturnValue(undefined as any);
        advisor['processOneMinuteCandle'](defaultCandle);
        expect(addSpy).toHaveBeenCalledWith(defaultCandle);
      });

      it('should not emit timeframe candle event when addSmallCandle returns a falsy value', () => {
        vi.spyOn(advisor['candleBatcher'], 'addSmallCandle').mockReturnValue(undefined as any);
        advisor['processOneMinuteCandle'](defaultCandle);
        expect(advisor['addDeferredEmit']).not.toHaveBeenCalled();
      });

      it('should emit STRATEGY_TIMEFRAME_CANDLE_EVENT when addSmallCandle returns a new candle', () => {
        vi.spyOn(advisor['candleBatcher'], 'addSmallCandle').mockReturnValue(defaultCandle);
        advisor['processOneMinuteCandle'](defaultCandle);
        expect(advisor['addDeferredEmit']).toHaveBeenCalledExactlyOnceWith(TIMEFRAME_CANDLE_EVENT, defaultCandle);
      });
    });

    describe('processFinalize', () => {
      beforeEach(async () => {
        await advisor['processInit']();
      });
      it('should call strategyManager.finish when processFinalize is called', () => {
        advisor['strategyManager']!.onStrategyEnd = vi.fn();
        advisor['processFinalize']();
        expect(advisor['strategyManager']?.onStrategyEnd).toHaveBeenCalled();
      });
    });
  });

  describe('relay functions', () => {
    beforeEach(async () => {
      await advisor['processInit']();
    });
    describe('relayStrategyWarmupCompleted', () => {
      it('should emit STRATEGY_WARMUP_COMPLETED_EVENT in relayStrategyWarmupCompleted', () => {
        const payload = { warmup: true };
        advisor['relayStrategyWarmupCompleted'](payload);
        expect(advisor['addDeferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_WARMUP_COMPLETED_EVENT, payload);
      });
    });

    describe('relayCreateOrder', () => {
      it('should emit STRATEGY_CREATE_ORDER_EVENT in relayCreateOrder', () => {
        advisor['relayCreateOrder'](defaultAdvice);
        expect(advisor['addDeferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_CREATE_ORDER_EVENT, defaultAdvice);
      });
    });

    describe('relayStrategyinfo', () => {
      it('should emit STRATEGY_INFO_EVENT in relayStrategyinfo when strategy logs are emited', () => {
        const strategyInfoPayload: StrategyInfo = {
          level: 'debug',
          message: 'Hello World !',
          tag: 'strategy',
          timestamp: 123456789,
        };
        advisor['relayStrategyInfo'](strategyInfoPayload);
        expect(advisor['addDeferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_INFO_EVENT, strategyInfoPayload);
      });
    });

    describe('relayCancelOrder', () => {
      it('should throw GekkoError in relayCancelOrder if no candle is set', () => {
        (advisor as any).candle = undefined;
        expect(() => advisor['relayCancelOrder'](defaultCanceledOrder.order.id)).toThrow(GekkoError);
      });

      it('should emit STRATEGY_CANCEL_ORDER_EVENT in relayCancelOrder when a candle is set', () => {
        (advisor as any).candle = defaultCandle;
        advisor['relayCancelOrder'](defaultCanceledOrder.order.id);
        expect(advisor['addDeferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_CANCEL_ORDER_EVENT, defaultCanceledOrder.order.id);
      });
    });
  });

  describe('listeners functions', () => {
    beforeEach(async () => {
      await advisor['processInit']();
    });

    describe('onOrderCompleted', () => {
      it('should call strategyManager.onOrderCompleted when onOrderCompleted is called', async () => {
        advisor['strategyManager']!.onOrderCompleted = vi.fn();
        await advisor.onOrderCompleted([defaultBuyTradeEvent]);
        expect(advisor['strategyManager']?.onOrderCompleted).toHaveBeenCalledExactlyOnceWith(defaultBuyTradeEvent);
      });
    });

    describe('onOrderCanceled', () => {
      it('should call strategyManager.onOrderCanceled when onOrderCanceled is called', async () => {
        advisor['strategyManager']!.onOrderCanceled = vi.fn();
        await advisor.onOrderCanceled([defaultCanceledOrder]);
        expect(advisor['strategyManager']?.onOrderCanceled).toHaveBeenCalledExactlyOnceWith(defaultCanceledOrder);
      });
    });

    describe('onOrderErrored', () => {
      it('should call strategyManager.onOrderErrored when onOrderErrored is called', async () => {
        advisor['strategyManager']!.onOrderErrored = vi.fn();
        await advisor.onOrderErrored([defaultErroredOrder]);
        expect(advisor['strategyManager']?.onOrderErrored).toHaveBeenCalledExactlyOnceWith(defaultErroredOrder);
      });
    });

    describe('onPortfolioChange', () => {
      it('should forward latest portfolio to the strategy manager', () => {
        const portfolio = new Map<string, BalanceDetail>([
          ['asset', { free: 5, used: 0, total: 5 }],
          ['currency', { free: 10, used: 0, total: 10 }],
        ]);
        advisor['strategyManager']!.setPortfolio = vi.fn();

        advisor.onPortfolioChange([portfolio]);

        expect(advisor['strategyManager']?.setPortfolio).toHaveBeenCalledExactlyOnceWith(portfolio);
      });
    });

    describe('onTimeframeCandle', () => {
      it('should forward timeframe candles to the strategy manager', () => {
        const timeframeCandle: Candle = { ...defaultCandle, close: 123 };
        advisor['strategyManager']!.onTimeFrameCandle = vi.fn();

        advisor.onTimeframeCandle([timeframeCandle]);

        expect(advisor['strategyManager']?.onTimeFrameCandle).toHaveBeenCalledExactlyOnceWith(timeframeCandle);
      });

      it('should ignore timeframe candles when strategy manager is not initialized', () => {
        const notInitializedAdvisor = new TradingAdvisor(config);
        attachMockExchange(notInitializedAdvisor);
        expect(() => notInitializedAdvisor.onTimeframeCandle([defaultCandle])).not.toThrow();
      });
    });
  });
});
