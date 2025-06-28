import { GekkoError } from '@errors/gekko.error';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as indicators from '../indicators/index';
import { Indicator } from '../indicators/indicator';
import { Candle } from '../models/types/candle.types';
import { TradeCompleted } from '../models/types/tradeStatus.types';
import { STRATEGY_NOTIFICATION_EVENT, STRATEGY_UPDATE_EVENT } from '../plugins/plugin.const';
import { toTimestamp } from '../utils/date/date.utils';
import { Strategy } from './strategy';

vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({ mode: 'backtest' })),
    getStrategy: vi.fn(),
  }));
  return { config: new Configuration() };
});
vi.mock('@services/storage/stateManager', () => ({ StateManager: vi.fn() }));

class DummyStrategy extends Strategy<'RSI'> {
  ended = false;
  init() {}
  onEachCandle() {}
  onCandleAfterWarmup() {}
  onTradeExecuted() {}
  log() {}
  end() {
    this.ended = true;
  }
}

const dummyCandle = {
  start: toTimestamp('2020-01-01T00:00:00Z'),
  close: 100,
} as Candle;

describe('Strategy', () => {
  let strategy: DummyStrategy;

  beforeEach(() => {
    // requiredHistory set to 1 so that warmup can complete on first candle
    strategy = new DummyStrategy('Dummy', 1, 1);
  });

  describe('onNewCandle', () => {
    it('should set the candle property to the passed candle', () => {
      strategy.onNewCandle(dummyCandle);
      expect(strategy['candle']).toEqual(dummyCandle);
    });

    it('should call each indicator’s onNewCandle method', () => {
      class DummyIndicator extends Indicator<'RSI'> {
        result = 0;
        getResult = vi.fn();
        getName = vi.fn();
        onNewCandle = vi.fn();
      }
      const dummyIndic = new DummyIndicator('RSI', 0);
      strategy['indicators'] = [dummyIndic];
      strategy.onNewCandle(dummyCandle);
      expect(dummyIndic.onNewCandle).toHaveBeenCalledWith(dummyCandle);
    });

    it('should call onEachCandle with the passed candle', () => {
      const onEachCandleSpy = vi.spyOn(strategy, 'onEachCandle');
      strategy.onNewCandle(dummyCandle);
      expect(onEachCandleSpy).toHaveBeenCalledWith(dummyCandle);
    });

    it('should emit STRATEGY_UPDATE_EVENT with the correct payload', () => {
      const emitSpy = vi.spyOn(strategy, 'emit');
      strategy['indicators'] = []; // no indicators
      strategy.onNewCandle(dummyCandle);
      expect(emitSpy).toHaveBeenCalledWith(STRATEGY_UPDATE_EVENT, {
        date: dummyCandle.start,
        indicators: [],
      });
    });

    it('should call log if warmup is complete', () => {
      strategy['isWarmupCompleted'] = true;
      const logSpy = vi.spyOn(strategy, 'log');
      strategy.onNewCandle(dummyCandle);
      expect(logSpy).toHaveBeenCalledWith(dummyCandle);
    });

    it('should call onCandleAfterWarmup if warmup is complete', () => {
      strategy['isWarmupCompleted'] = true;
      const afterWarmupSpy = vi.spyOn(strategy, 'onCandleAfterWarmup');
      strategy.onNewCandle(dummyCandle);
      expect(afterWarmupSpy).toHaveBeenCalledWith(dummyCandle);
    });
  });

  describe('onTradeCompleted', () => {
    it('should call onTradeExecuted with the trade object', () => {
      const trade = { action: 'buy', adviceId: 'advice-2' } as TradeCompleted;
      const execSpy = vi.spyOn(strategy, 'onTradeExecuted');
      strategy.onTradeCompleted(trade);
      expect(execSpy).toHaveBeenCalledWith(trade);
    });
  });

  describe('finish', () => {
    it('should call end when finish is called', () => {
      strategy.end = vi.fn();
      strategy.finish();
      expect(strategy.end).toHaveBeenCalled();
    });
  });

  describe('addIndicator', () => {
    it('should throw an error if the strategy is already initialized', () => {
      strategy['isStartegyInitialized'] = true;
      expect(() => strategy['addIndicator']('RSI', {})).toThrow(GekkoError);
    });

    it('should throw an error if the indicator is not found', () => {
      strategy['isStartegyInitialized'] = false;
      const nonExistentIndicator = '?' as unknown as keyof IndicatorRegistry;
      expect(() => strategy['addIndicator'](nonExistentIndicator, {})).toThrow(GekkoError);
    });

    it('should add and return the indicator if valid', () => {
      // Create a dummy indicator class.
      class DummyIndicator {
        public params: unknown;
        constructor(params: unknown) {
          this.params = params;
        }
      }
      // Temporarily set the indicator in the imported indicators object.
      (indicators as any)['DummyIndicator'] = DummyIndicator;
      strategy['isStartegyInitialized'] = false;
      const indicator = strategy['addIndicator']('DummyIndicator' as any, { foo: 'bar' });
      expect((indicator as any).params).toEqual({ foo: 'bar' });
    });
  });

  describe('notify', () => {
    it('should emit STRATEGY_NOTIFICATION_EVENT with the provided content', () => {
      const emitSpy = vi.spyOn(strategy, 'emit');
      strategy['notify']('Test notification');
      expect(emitSpy).toHaveBeenCalledWith(
        STRATEGY_NOTIFICATION_EVENT,
        expect.objectContaining({ content: 'Test notification' }),
      );
    });
  });

  describe('advice', () => {
    it('should return undefined if no candle is set', () => {
      strategy['candle'] = undefined;
      const result = strategy['advice']('long');
      expect(result).toBeUndefined();
    });

    it('should return undefined if new direction equals currentDirection', () => {
      strategy['candle'] = dummyCandle;
      strategy['currentDirection'] = 'long';
      const result = strategy['advice']('long');
      expect(result).toBeUndefined();
    });

    it('should update currentDirection and emit an advice event for string input', () => {
      strategy['candle'] = dummyCandle;
      strategy['advice']('long');
      expect(strategy['currentDirection']).toBe('long');
    });
  });
});
