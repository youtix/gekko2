// tradingAdvisor.test.ts
import { addMinutes } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';
import { PluginError } from '../../errors/plugin/plugin.error';
import { StrategyNotFoundError } from '../../errors/strategy/strategyNotFound.error';
import { toTimestamp } from '../../utils/date/date.utils';
import { TradingAdvisor } from './tradingAdvisor';
import {
  ADVICE_EVENT,
  STRATEGY_CANDLE_EVENT,
  STRATEGY_NOTIFICATION_EVENT,
  STRATEGY_UPDATE_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from './tradingAdvisor.const';
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
  const config = {
    name: 'TradingAdvisor',
    timeframe: '1m',
    strategyName: 'DummyStrategy',
    historySize: 10,
    windowMode: 'calendar',
  } satisfies TradingAdvisorConfiguration;
  const advisor = new TradingAdvisor(config);
  advisor['deferredEmit'] = vi.fn();

  describe('constructor', () => {
    it('should throw StrategyNotFoundError if an invalid strategy name is provided', () => {
      expect(
        () =>
          new TradingAdvisor({
            name: 'TradingAdvisor',
            timeframe: '1m',
            strategyName: 'NonExistentStrategy',
            historySize: 10,
            windowMode: 'calendar',
          }),
      ).toThrowError(StrategyNotFoundError);
    });
    it('should create a strategy when a valid strategy name is provided', () => {
      expect(advisor.strategy).toBeDefined();
    });
  });

  describe('processCandle', () => {
    it('should update the candle property when processCandle is called', () => {
      const dummyCandle = { start: toTimestamp('2025-01-01T00:00:00Z') };
      advisor['processCandle'](dummyCandle);
      expect(advisor.candle).toEqual(dummyCandle);
    });

    it('should emit STRATEGY_CANDLE_EVENT when addSmallCandle returns a new candle', () => {
      const dummyCandle = { start: toTimestamp('2025-01-01T00:00:00Z') };
      const newCandle = { dummy: 'newCandle' };
      advisor.candleBatcher.addSmallCandle = vi.fn(() => newCandle);
      advisor['processCandle'](dummyCandle);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_CANDLE_EVENT, newCandle);
    });

    it('should call strategy.onNewCandle when addSmallCandle returns a new candle', () => {
      const dummyCandle = { start: toTimestamp('2025-01-01T00:00:00Z') };
      const newCandle = { dummy: 'newCandle' };
      advisor.candleBatcher.addSmallCandle = vi.fn(() => newCandle);
      advisor.strategy.onNewCandle = vi.fn();
      advisor['processCandle'](dummyCandle);
      expect(advisor.strategy.onNewCandle).toHaveBeenCalledExactlyOnceWith(newCandle);
    });

    it('should NOT emit any event when addSmallCandle returns a falsy value', () => {
      const dummyCandle = { start: toTimestamp('2025-01-01T00:00:00Z') };
      advisor.candleBatcher.addSmallCandle = vi.fn(() => undefined);
      advisor['processCandle'](dummyCandle);
      expect(advisor['deferredEmit']).not.toHaveBeenCalled();
    });

    it('should NOT call strategy.onNewCandle when addSmallCandle returns a falsy value', () => {
      const dummyCandle = { start: toTimestamp('2025-01-01T00:00:00Z') };
      advisor.candleBatcher.addSmallCandle = vi.fn(() => undefined);
      advisor['processCandle'](dummyCandle);
      expect(advisor.strategy.onNewCandle).not.toHaveBeenCalled();
    });
  });

  describe('onTradeCompleted', () => {
    it('should call strategy.onTradeCompleted when onTradeCompleted is called', () => {
      const dummyTrade = { trade: 'dummy' };
      advisor.strategy.onTradeCompleted = vi.fn();
      advisor.onTradeCompleted(dummyTrade);
      expect(advisor.strategy.onTradeCompleted).toHaveBeenCalledExactlyOnceWith(dummyTrade);
    });
  });

  describe('processFinalize', () => {
    it('should call strategy.finish when processFinalize is called', () => {
      advisor.strategy.finish = vi.fn();
      advisor['processFinalize']();
      expect(advisor.strategy.finish).toHaveBeenCalled();
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
      const dummyAdvice = { advice: 'dummy' };
      expect(() => advisor['relayAdvice'](dummyAdvice)).toThrow(PluginError);
    });

    it('should emit ADVICE_EVENT in relayAdvice when a candle is set', () => {
      const candleStart = toTimestamp('2025-01-01T00:00:00Z');
      advisor.candle = { start: candleStart };
      const dummyAdvice = { advice: 'dummy' };
      advisor['relayAdvice'](dummyAdvice);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(ADVICE_EVENT, {
        ...dummyAdvice,
        date: addMinutes(candleStart, 1),
      });
    });
  });
});
