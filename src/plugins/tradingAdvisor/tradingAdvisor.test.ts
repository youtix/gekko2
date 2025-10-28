// tradingAdvisor.test.ts
import {
  STRATEGY_ADVICE_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
  TIMEFRAME_CANDLE_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { Advice } from '@models/advice.types';
import { Candle } from '@models/candle.types';
import { StrategyInfo } from '@models/strategyInfo.types';
import { TradeCompleted } from '@models/tradeStatus.types';
import { addMinutes } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';
import { TradingAdvisor } from './tradingAdvisor';
import { TradingAdvisorConfiguration } from './tradingAdvisor.types';

vi.mock('@strategies/index', () => ({
  DummyStrategy: class {
    init = vi.fn();
    onNewCandle = vi.fn();
    onTradeCompleted = vi.fn();
    finish = vi.fn();
    on() {
      return this;
    }
  },
  NonExistentStrategy: undefined,
}));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({})),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

describe('TradingAdvisor', () => {
  const config = {
    name: 'TradingAdvisor',
    strategyName: 'DummyStrategy',
  } satisfies TradingAdvisorConfiguration;
  const defaultAdvice: Advice = { id: 'advice-100', recommendation: 'short', date: toTimestamp('2020') };
  const defaultCandle: Candle = { close: 100, high: 150, low: 90, open: 110, start: toTimestamp('2025'), volume: 10 };
  const defaultBuyTradeEvent: TradeCompleted = {
    action: 'BUY',
    id: 'BUY',
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

  let advisor: TradingAdvisor;

  beforeEach(() => {
    advisor = new TradingAdvisor(config);
    advisor['deferredEmit'] = vi.fn();
  });

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

    it('should call strategyManager.onNewCandle when addSmallCandle returns a new candle', () => {
      advisor['candleBatcher'].addSmallCandle = vi.fn(() => defaultCandle);
      advisor['strategyManager']!.onNewCandle = vi.fn();
      advisor['processOneMinuteCandle'](defaultCandle);
      expect(advisor['strategyManager']?.onNewCandle).toHaveBeenCalledWith(defaultCandle);
    });

    it('should NOT call strategyManager.onNewCandle when addSmallCandle returns a falsy value', () => {
      advisor['candleBatcher'].addSmallCandle = vi.fn(() => undefined);
      advisor['strategyManager']!.onNewCandle = vi.fn();
      advisor['processOneMinuteCandle'](defaultCandle);
      expect(advisor['strategyManager']?.onNewCandle).not.toHaveBeenCalled();
    });

    it('should emit STRATEGY_TIMEFRAME_CANDLE_EVENT when addSmallCandle returns a new candle', () => {
      advisor['candleBatcher']['addSmallCandle'] = vi.fn(() => defaultCandle);
      advisor['strategyManager']!.onNewCandle = vi.fn();
      advisor['processOneMinuteCandle'](defaultCandle);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(TIMEFRAME_CANDLE_EVENT, defaultCandle);
    });
  });

  describe('onTradeCompleted', () => {
    beforeEach(async () => {
      await advisor['processInit']();
    });
    it('should call strategyManager.onTradeCompleted when onTradeCompleted is called', () => {
      advisor['strategyManager']!.onTradeCompleted = vi.fn();
      advisor.onTradeCompleted(defaultBuyTradeEvent);
      expect(advisor['strategyManager']?.onTradeCompleted).toHaveBeenCalledExactlyOnceWith(defaultBuyTradeEvent);
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
  describe('relay functions', () => {
    beforeEach(async () => {
      await advisor['processInit']();
    });
    it('should emit STRATEGY_WARMUP_COMPLETED_EVENT in relayStrategyWarmupCompleted', () => {
      const payload = { warmup: true };
      advisor['relayStrategyWarmupCompleted'](payload);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_WARMUP_COMPLETED_EVENT, payload);
    });

    it('should throw GekkoError in relayAdvice if no candle is set', () => {
      (advisor as any).candle = undefined;
      expect(() => advisor['relayAdvice'](defaultAdvice)).toThrow(GekkoError);
    });

    it('should emit STRATEGY_ADVICE_EVENT in relayAdvice when a candle is set', () => {
      const candleStart = toTimestamp('2025-01-01T00:00:00Z');
      (advisor as any).candle = defaultCandle;
      advisor['relayAdvice'](defaultAdvice);
      expect(advisor['deferredEmit']).toHaveBeenCalledExactlyOnceWith(STRATEGY_ADVICE_EVENT, {
        ...defaultAdvice,
        date: addMinutes(candleStart, 1).getTime(),
      });
    });

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
});
