import {
  STRATEGY_CANCEL_ORDER_EVENT,
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TIMEFRAME_CANDLE_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { Advice } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { OrderCanceled, OrderCompleted, OrderErrored } from '@models/order.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { addMinutes } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';
import { TradingAdvisor } from './tradingAdvisor';
import { TradingAdvisorConfiguration } from './tradingAdvisor.types';

vi.mock('@strategies/index', () => ({
  DummyStrategy: class {
    init = vi.fn();
    onNewCandle = vi.fn();
    onOrderCompleted = vi.fn();
    finish = vi.fn();
    on() {
      return this;
    }
  },
  NonExistentStrategy: undefined,
}));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({ warmup: {} })),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

describe('TradingAdvisor', () => {
  const config = {
    name: 'TradingAdvisor',
    strategyName: 'DummyStrategy',
  } satisfies TradingAdvisorConfiguration;
  const defaultAdvice: Advice = {
    id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
    date: toTimestamp('2020'),
    order: { type: 'STICKY', side: 'SELL', quantity: 1 },
  };
  const defaultCandle: Candle = { close: 100, high: 150, low: 90, open: 110, start: toTimestamp('2025'), volume: 10 };
  const defaultBuyTradeEvent: OrderCompleted = {
    orderId: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
    side: 'BUY',
    date: 0,
    portfolio: { asset: 100, currency: 200 },
    balance: 1000,
    price: 100,
    fee: 1,
    amount: 30,
    effectivePrice: 31,
    feePercent: 0.33,
    type: 'STICKY',
  };
  const defaultCanceledOrder: OrderCanceled = {
    orderId: '91f8d591-1a72-4d26-9477-5455e8d88111',
    date: 0,
    type: 'STICKY',
    side: 'BUY',
    amount: 5,
    filled: 2,
    remaining: 3,
  };
  const defaultErroredOrder: OrderErrored = {
    orderId: defaultCanceledOrder.orderId,
    date: 0,
    type: 'STICKY',
    side: 'BUY',
    reason: 'Order errored',
    amount: 2,
  };

  let advisor: TradingAdvisor;

  beforeEach(() => {
    advisor = new TradingAdvisor(config);
    advisor['deferredEmit'] = vi.fn();
  });

  describe('life cycle functions', () => {
    describe('processInit', () => {
      it('should throw StrategyNotFoundError if an invalid strategy name is provided', async () => {
        const badAdvisor = new TradingAdvisor({
          name: 'TradingAdvisor',
          strategyName: 'NonExistentStrategy',
        });
        await expect(() => badAdvisor['processInit']()).rejects.toThrowError(GekkoError);
      });
      it('should create a strategy manager when a valid strategy name is provided', async () => {
        await advisor['processInit']();
        expect(advisor['strategyManager']).toBeDefined();
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
        expect(advisor['deferredEmit']).not.toHaveBeenCalled();
      });

      it('should emit STRATEGY_TIMEFRAME_CANDLE_EVENT when addSmallCandle returns a new candle', () => {
        vi.spyOn(advisor['candleBatcher'], 'addSmallCandle').mockReturnValue(defaultCandle);
        advisor['processOneMinuteCandle'](defaultCandle);
        expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(TIMEFRAME_CANDLE_EVENT, defaultCandle);
      });
    });

    describe('processFinalize', () => {
      beforeEach(async () => {
        await advisor['processInit']();
      });
      it('should call strategyManager.finish when processFinalize is called', () => {
        advisor['strategyManager']!.finish = vi.fn();
        advisor['processFinalize']();
        expect(advisor['strategyManager']?.finish).toHaveBeenCalled();
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
        expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_WARMUP_COMPLETED_EVENT, payload);
      });
    });

    describe('relayCreateOrder', () => {
      it('should throw GekkoError in relayCreateOrder if no candle is set', () => {
        (advisor as any).candle = undefined;
        expect(() => advisor['relayCreateOrder'](defaultAdvice)).toThrow(GekkoError);
      });

      it('should emit STRATEGY_CREATE_ORDER_EVENT in relayCreateOrder when a candle is set', () => {
        const candleStart = toTimestamp('2025-01-01T00:00:00Z');
        (advisor as any).candle = defaultCandle;
        advisor['relayCreateOrder'](defaultAdvice);
        expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_CREATE_ORDER_EVENT, {
          ...defaultAdvice,
          date: addMinutes(candleStart, 1).getTime(),
        });
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
        expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_INFO_EVENT, strategyInfoPayload);
      });
    });

    describe('relayCancelOrder', () => {
      it('should throw GekkoError in relayCancelOrder if no candle is set', () => {
        (advisor as any).candle = undefined;
        expect(() => advisor['relayCancelOrder'](defaultCanceledOrder.orderId)).toThrow(GekkoError);
      });

      it('should emit STRATEGY_CANCEL_ORDER_EVENT in relayCancelOrder when a candle is set', () => {
        (advisor as any).candle = defaultCandle;
        advisor['relayCancelOrder'](defaultCanceledOrder.orderId);
        expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(
          STRATEGY_CANCEL_ORDER_EVENT,
          defaultCanceledOrder.orderId,
        );
      });
    });
  });

  describe('listeners functions', () => {
    beforeEach(async () => {
      await advisor['processInit']();
    });

    describe('onOrderCompleted', () => {
      it('should call strategyManager.onOrderCompleted when onOrderCompleted is called', () => {
        advisor['strategyManager']!.onOrderCompleted = vi.fn();
        advisor.onOrderCompleted(defaultBuyTradeEvent);
        expect(advisor['strategyManager']?.onOrderCompleted).toHaveBeenCalledExactlyOnceWith(defaultBuyTradeEvent);
      });
    });

    describe('onOrderCanceled', () => {
      it('should call strategyManager.onOrderCanceled when onOrderCanceled is called', () => {
        advisor['strategyManager']!.onOrderCanceled = vi.fn();
        advisor.onOrderCanceled(defaultCanceledOrder);
        expect(advisor['strategyManager']?.onOrderCanceled).toHaveBeenCalledExactlyOnceWith(defaultCanceledOrder);
      });
    });

    describe('onOrderErrored', () => {
      it('should call strategyManager.onOrderErrored when onOrderErrored is called', () => {
        advisor['strategyManager']!.onOrderErrored = vi.fn();
        advisor.onOrderErrored(defaultErroredOrder);
        expect(advisor['strategyManager']?.onOrderErrored).toHaveBeenCalledExactlyOnceWith(defaultErroredOrder);
      });
    });

    describe('onPortfolioChange', () => {
      it('should forward latest portfolio to the strategy manager', () => {
        const portfolio = { asset: 5, currency: 10 };
        advisor['strategyManager']!.onPortfolioChange = vi.fn();

        advisor.onPortfolioChange(portfolio);

        expect(advisor['strategyManager']?.onPortfolioChange).toHaveBeenCalledExactlyOnceWith(portfolio);
      });
    });

    describe('onTimeframeCandle', () => {
      it('should forward timeframe candles to the strategy manager', () => {
        const timeframeCandle: Candle = { ...defaultCandle, close: 123 };
        advisor['strategyManager']!.onNewCandle = vi.fn();

        advisor.onTimeframeCandle(timeframeCandle);

        expect(advisor['strategyManager']?.onNewCandle).toHaveBeenCalledExactlyOnceWith(timeframeCandle);
      });

      it('should ignore timeframe candles when strategy manager is not initialized', () => {
        const notInitializedAdvisor = new TradingAdvisor(config);
        expect(() => notInitializedAdvisor.onTimeframeCandle(defaultCandle)).not.toThrow();
      });
    });
  });
});
