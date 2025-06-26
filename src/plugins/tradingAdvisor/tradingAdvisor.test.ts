// tradingAdvisor.test.ts
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { addMinutes } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';
import { PluginError } from '../../errors/plugin/plugin.error';
import { StrategyNotFoundError } from '../../errors/strategy/strategyNotFound.error';
import { toTimestamp } from '../../utils/date/date.utils';
import {
  STRATEGY_ADVICE_EVENT,
  STRATEGY_CANDLE_EVENT,
  STRATEGY_NOTIFICATION_EVENT,
  STRATEGY_UPDATE_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from '../plugin.const';
import { TradingAdvisor } from './tradingAdvisor';
import { TradingAdvisorConfiguration } from './tradingAdvisor.types';

vi.mock('../../strategies/index', () => ({
  DummyStrategy: class {
    onNewCandle = vi.fn();
    onTradeCompleted = vi.fn();
    finish = vi.fn();
    on() {
      return this;
    }
  },
  NonExistentStrategy: undefined,
}));
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({})),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

describe('TradingAdvisor', () => {
  const config = { name: 'TradingAdvisor', strategyName: 'DummyStrategy' } satisfies TradingAdvisorConfiguration;
  const defaultAdvice: Advice = { id: 'advice-100', recommendation: 'short', date: toTimestamp('2020') };
  const defaultCandle: Candle = { close: 100, high: 150, low: 90, open: 110, start: toTimestamp('2025'), volume: 10 };
  const defaultBuyTradeEvent: TradeCompleted = {
    action: 'buy',
    id: 'buy',
    adviceId: 'buyAdvice',
    date: 0,
    portfolio: { asset: 100, currency: 200 },
    balance: 1000,
    price: 100,
    cost: 1,
    amount: 30,
    effectivePrice: 31,
    feePercent: 0.33,
  };
  const advisor = new TradingAdvisor(config);
  advisor['deferredEmit'] = vi.fn();

  describe('constructor', () => {
    it('should throw StrategyNotFoundError if an invalid strategy name is provided', () => {
      expect(
        () =>
          new TradingAdvisor({
            name: 'TradingAdvisor',
            strategyName: 'NonExistentStrategy',
          }),
      ).toThrowError(StrategyNotFoundError);
    });
    it('should create a strategy when a valid strategy name is provided', () => {
      expect(advisor.strategy).toBeDefined();
    });
  });

  describe('processOneMinuteCandle', () => {
    it('should update the candle property when processOneMinuteCandle is called', () => {
      advisor['processOneMinuteCandle'](defaultCandle);
      expect(advisor.candle).toEqual(defaultCandle);
    });

    it('should emit STRATEGY_CANDLE_EVENT when addSmallCandle returns a new candle', () => {
      advisor.candleBatcher['addSmallCandle'] = vi.fn(() => defaultCandle);
      advisor['processOneMinuteCandle'](defaultCandle);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_CANDLE_EVENT, defaultCandle);
    });

    it('should call strategy.onNewCandle when addSmallCandle returns a new candle', () => {
      advisor.candleBatcher.addSmallCandle = vi.fn(() => defaultCandle);
      advisor.strategy!.onNewCandle = vi.fn();
      advisor['processOneMinuteCandle'](defaultCandle);
      expect(advisor.strategy?.onNewCandle).toHaveBeenCalledExactlyOnceWith(defaultCandle);
    });

    it('should NOT emit any event when addSmallCandle returns a falsy value', () => {
      advisor.candleBatcher.addSmallCandle = vi.fn(() => undefined);
      advisor['processOneMinuteCandle'](defaultCandle);
      expect(advisor['deferredEmit']).not.toHaveBeenCalled();
    });

    it('should NOT call strategy.onNewCandle when addSmallCandle returns a falsy value', () => {
      advisor.candleBatcher.addSmallCandle = vi.fn(() => undefined);
      advisor['processOneMinuteCandle'](defaultCandle);
      expect(advisor.strategy?.onNewCandle).not.toHaveBeenCalled();
    });
  });

  describe('onTradeCompleted', () => {
    it('should call strategy.onTradeCompleted when onTradeCompleted is called', () => {
      advisor.strategy!.onTradeCompleted = vi.fn();
      advisor.onTradeCompleted(defaultBuyTradeEvent);
      expect(advisor.strategy?.onTradeCompleted).toHaveBeenCalledExactlyOnceWith(defaultBuyTradeEvent);
    });
  });

  describe('processFinalize', () => {
    it('should call strategy.finish when processFinalize is called', () => {
      advisor.strategy!.finish = vi.fn();
      advisor['processFinalize']();
      expect(advisor.strategy?.finish).toHaveBeenCalled();
    });
  });
  describe('relay functions', () => {
    it('should emit STRATEGY_WARMUP_COMPLETED_EVENT in relayStrategyWarmupCompleted', () => {
      const payload = { warmup: true };
      advisor['relayStrategyWarmupCompleted'](payload);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_WARMUP_COMPLETED_EVENT, payload);
    });

    it('should emit STRATEGY_UPDATE_EVENT in relayStrategyUpdate', () => {
      const payload = { update: true };
      advisor['relayStrategyUpdate'](payload);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_UPDATE_EVENT, payload);
    });

    it('should emit STRATEGY_NOTIFICATION_EVENT in relayStrategyNotification', () => {
      const payload = { notification: true };
      advisor['relayStrategyNotification'](payload);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_NOTIFICATION_EVENT, payload);
    });

    it('should throw PluginError in relayAdvice if no candle is set', () => {
      advisor.candle = undefined;
      expect(() => advisor['relayAdvice'](defaultAdvice)).toThrow(PluginError);
    });

    it('should emit STRATEGY_ADVICE_EVENT in relayAdvice when a candle is set', () => {
      const candleStart = toTimestamp('2025-01-01T00:00:00Z');
      advisor.candle = defaultCandle;
      advisor['relayAdvice'](defaultAdvice);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_ADVICE_EVENT, {
        ...defaultAdvice,
        date: addMinutes(candleStart, 1).getTime(),
      });
    });
  });
});
