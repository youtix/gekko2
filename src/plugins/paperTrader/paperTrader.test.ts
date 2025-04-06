import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginError } from '../../errors/plugin/plugin.error';
import { TrailingStop } from '../../services/core/order/trailingStop';
import { warning } from '../../services/logger';
import { toTimestamp } from '../../utils/date/date.utils';
import {
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
  TRADE_COMPLETED_EVENT,
  TRADE_INITIATED_EVENT,
  TRIGGER_CREATED_EVENT,
  TRIGGER_FIRED_EVENT,
} from '../plugin.const';
import { PaperTrader } from './paperTrader';
import { PapertraderConfig } from './paperTrader.types';

vi.mock('@services/logger', () => ({ warning: vi.fn() }));
vi.mock('@services/core/order/trailingStop', () => ({
  TrailingStop: vi.fn(() => ({ updatePrice: vi.fn() })),
}));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getWatch = vi.fn(() => ({ mode: 'realtime' }));
  return { config: new Configuration() };
});

describe('PaperTrader', () => {
  const papertraderConfig = {
    feeUsing: 'maker',
    feeMaker: 0.25,
    feeTaker: 0.4,
    simulationBalance: {
      asset: 0,
      currency: 1000,
    },
  } as PapertraderConfig;
  let trader: PaperTrader;
  beforeEach(() => {
    trader = new PaperTrader(papertraderConfig);
    trader['deferredEmit'] = vi.fn();
  });
  describe('constructor', () => {
    it('should initialize with correct fee', () => {
      expect(trader['fee']).toBe(0.9975);
    });
  });
  describe('onStrategyWarmupCompleted', () => {
    it('should throw if no warmup candle is set', () => {
      expect(() => trader.onStrategyWarmupCompleted()).toThrowError(PluginError);
    });
    it('should mark warmup completed', () => {
      trader['warmupCandle'] = { close: 130 };

      trader.onStrategyWarmupCompleted();

      expect(trader['warmupCompleted']).toBe(true);
    });
    it('should call process candle function', () => {
      trader['warmupCandle'] = { close: 130 };
      const processCandleSpy = vi.spyOn(trader, 'processCandle');

      trader.onStrategyWarmupCompleted();

      expect(processCandleSpy).toHaveBeenCalledExactlyOnceWith({ close: 130 });
    });
  });
  describe('onAdvice', () => {
    it('should clean up potential old stop trigger on "short" recommendation', () => {
      const advice = { id: 'advice-100', recommendation: 'short' };
      const trailingStopArgs = { initialPrice: 100, trail: 10, onTrigger: () => {} };
      trader['activeStopTrigger'] = {
        id: 'trigger-10',
        adviceId: 'advice-50',
        instance: new TrailingStop(trailingStopArgs),
      };
      trader['price'] = 100;
      trader.onAdvice(advice);
      expect(trader['activeStopTrigger']).toBeUndefined();
    });
    it('should clean up potential old stop trigger on "long" recommendation & advice contain trigger', () => {
      const trigger = { type: 'trailingStop', trailValue: 10, trailPercentage: 0.5 };
      const advice = { id: 'advice-100', recommendation: 'long', trigger };
      const trailingStopArgs = { initialPrice: 100, trail: 10, onTrigger: () => {} };
      trader['activeStopTrigger'] = {
        id: 'trigger-10',
        adviceId: 'advice-50',
        instance: new TrailingStop(trailingStopArgs),
      };
      trader['price'] = 100;
      vi.spyOn(trader, 'createTrigger').mockImplementationOnce(() => {});
      trader.onAdvice(advice);
      expect(trader['activeStopTrigger']).toBeUndefined();
    });
    it('should create a new trigger on "long" recommendation & advice contain trigger', () => {
      const trigger = { type: 'trailingStop', trailValue: 10, trailPercentage: 0.5 };
      const advice = { id: 'advice-100', recommendation: 'long', trigger };
      const trailingStopArgs = { initialPrice: 100, trail: 10, onTrigger: () => {} };
      trader['activeStopTrigger'] = {
        id: 'trigger-10',
        adviceId: 'advice-50',
        instance: new TrailingStop(trailingStopArgs),
      };
      trader['price'] = 100;
      const createTriggerSpy = vi.spyOn(trader, 'createTrigger').mockImplementationOnce(() => {});
      trader.onAdvice(advice);
      expect(createTriggerSpy).toHaveBeenCalledExactlyOnceWith(advice);
    });
    it('should ignore unknown recommendation', () => {
      const advice = { id: 'advice-100', recommendation: 'other than shoart and long reco' };
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');
      trader.onAdvice(advice);
      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });
    it('should emit tradeInitiated', () => {
      const advice = {
        id: 'advice-100',
        recommendation: 'short',
        date: toTimestamp('2020-01-01T00:00:00Z'),
      };
      trader['price'] = 100;
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({}));
      trader.onAdvice(advice);
      expect(deferredEmitSpy).toHaveBeenNthCalledWith(1, TRADE_INITIATED_EVENT, {
        id: 'trade-1',
        adviceId: advice.id,
        action: 'sell',
        portfolio: papertraderConfig.simulationBalance,
        balance: 1000,
        date: advice.date,
      });
    });
    it('should emit portfolioChange', () => {
      const advice = {
        id: 'advice-100',
        recommendation: 'short',
        date: toTimestamp('2020-01-01T00:00:00Z'),
      };
      trader['price'] = 100;
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({}));
      trader.onAdvice(advice);
      expect(deferredEmitSpy).toHaveBeenNthCalledWith(2, PORTFOLIO_CHANGE_EVENT, {
        asset: 0,
        currency: 1000,
      });
    });
    it('should emit portfolioValueChange', () => {
      const advice = {
        id: 'advice-100',
        recommendation: 'short',
        date: toTimestamp('2020-01-01T00:00:00Z'),
      };
      trader['price'] = 100;
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({}));
      trader.onAdvice(advice);
      expect(deferredEmitSpy).toHaveBeenNthCalledWith(3, PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 1000,
      });
    });
    it('should emit tradeCompleted', () => {
      const advice = {
        id: 'advice-100',
        recommendation: 'short',
        date: toTimestamp('2020-01-01T00:00:00Z'),
      };
      trader['price'] = 100;
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({
        cost: 10,
        amount: 200,
        effectivePrice: 99.75,
      }));
      trader.onAdvice(advice);
      expect(deferredEmitSpy).toHaveBeenNthCalledWith(4, TRADE_COMPLETED_EVENT, {
        id: 'trade-1',
        adviceId: advice.id,
        action: 'sell',
        cost: 10,
        amount: 200,
        price: 100,
        portfolio: { asset: 0, currency: 1000 },
        balance: 1000,
        date: advice.date,
        effectivePrice: 99.75,
        feePercent: 0.25,
      });
    });
  });
  describe('processCandle', () => {
    it('should store the candle as warmupCandle during warmup', () => {
      trader['warmupCompleted'] = false;
      const candle = { close: 100 };

      trader['processCandle'](candle);

      expect(trader['warmupCandle']).toEqual(candle);
    });
    it('should NOT update price during warmup', () => {
      trader['warmupCompleted'] = false;
      const candle = { close: 100 };

      trader['processCandle'](candle);

      expect(trader['price']).toBe(0);
    });
    it('should NOT update candle during warmup', () => {
      trader['warmupCompleted'] = false;
      const candle = { close: 100 };

      trader['processCandle'](candle);

      expect(trader['candle']).toBeUndefined();
    });
    it('should update price when warmup is done', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = 100;
      trader['exposed'] = false;
      trader['activeStopTrigger'] = undefined;
      const candle = { close: 150 };

      trader['processCandle'](candle);

      expect(trader['price']).toBe(150);
    });
    it('should update candle when warmup is done', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = 100;
      trader['exposed'] = false;
      trader['activeStopTrigger'] = undefined;
      const candle = { close: 150 };

      trader['processCandle'](candle);

      expect(trader['candle']).toStrictEqual(candle);
    });
    it('should set balance when warmup is done & balance is NOT set', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = NaN;
      trader['price'] = 100;
      trader['exposed'] = false;
      trader['activeStopTrigger'] = undefined;
      const candle = { close: 150 };

      trader['processCandle'](candle);

      expect(trader['balance']).toBe(1000);
    });
    it('should emit portfolio change event when warmup is done & balance is NOT set', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = NaN;
      trader['price'] = 100;
      trader['exposed'] = false;
      trader['activeStopTrigger'] = undefined;
      const candle = { close: 150 };
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');

      trader['processCandle'](candle);

      expect(deferredEmitSpy).toHaveBeenNthCalledWith(1, PORTFOLIO_CHANGE_EVENT, {
        asset: 0,
        currency: 1000,
      });
    });
    it('should emit portfolio value change event when warmup is done & balance is NOT set', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = NaN;
      trader['price'] = 100;
      trader['exposed'] = false;
      trader['activeStopTrigger'] = undefined;
      const candle = { close: 150 };
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');

      trader['processCandle'](candle);

      expect(deferredEmitSpy).toHaveBeenNthCalledWith(2, PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 1000,
      });
    });
    it('should emit portfolio value change event when warmup is done & exposed', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = 10;
      trader['price'] = 100;
      trader['exposed'] = true;
      trader['activeStopTrigger'] = undefined;
      const candle = { close: 150 };
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');

      trader['processCandle'](candle);

      expect(deferredEmitSpy).toHaveBeenCalledExactlyOnceWith(PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 1000,
      });
    });
    it('should NOT emit portfolio value change event when warmup is done & NOT exposed', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = 10;
      trader['price'] = 100;
      trader['exposed'] = false;
      trader['activeStopTrigger'] = undefined;
      const candle = { close: 150 };
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');

      trader['processCandle'](candle);

      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });
    it('should update price of active trailing stop if set when warmup is done', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = 1000;
      trader['exposed'] = true;
      const trailingStopArgs = { initialPrice: 100, trail: 10, onTrigger: () => {} };
      trader['activeStopTrigger'] = {
        id: 'trigger-10',
        adviceId: 'advice-50',
        instance: new TrailingStop(trailingStopArgs),
      };
      const candle = { close: 150 };

      trader['processCandle'](candle);

      expect(trader['activeStopTrigger'].instance.updatePrice).toHaveBeenCalledExactlyOnceWith(150);
    });
  });
  describe('createTrigger', () => {
    it('should emit triggerCreated event for a valid trailingStop trigger', () => {
      trader['price'] = 100;
      const advice = {
        id: 'test-advice-1',
        date: toTimestamp('2025-01-01T00:00:00Z'),
        trigger: { type: 'trailingStop', trailValue: 5 },
      };
      const deferredEmitSpy = vi.spyOn(trader, 'deferredEmit');

      trader['createTrigger'](advice);

      expect(deferredEmitSpy).toHaveBeenCalledExactlyOnceWith(TRIGGER_CREATED_EVENT, {
        id: 'trigger-1',
        at: advice.date,
        type: 'trailingStop',
        proprties: { trail: 5, initialPrice: 100 },
      });
    });
    it('should set activeStopTrigger with correct properties for a valid trailingStop trigger', () => {
      const advice = {
        id: 'test-advice-1',
        date: toTimestamp('2025-01-01T00:00:00Z'),
        trigger: { type: 'trailingStop', trailValue: 5 },
      };

      trader['createTrigger'](advice);

      expect(trader['activeStopTrigger']).toEqual({
        id: 'trigger-1',
        adviceId: 'test-advice-1',
        instance: expect.any(Object),
      });
    });
    it('should log if a trailingStop trigger is missing a trailValue', () => {
      const advice = {
        id: 'test-advice-2',
        date: toTimestamp('2025-01-01T01:00:00Z'),
        trigger: { type: 'trailingStop' },
      };

      trader['createTrigger'](advice);

      expect(warning).toHaveBeenCalledWith('paper trader', 'Ignoring trailing stop without trail value');
    });
    it('should log if trigger type is unknown', () => {
      const advice = {
        id: 'test-advice-3',
        date: toTimestamp('2025-01-01T02:00:00Z'),
        trigger: { type: 'unknown', trailValue: 5 },
      };

      trader['createTrigger'](advice);

      expect(warning).toHaveBeenCalledWith(
        'paper trader',
        'Gekko does not know trigger with type "unknown".. Ignoring stop.',
      );
    });
  });
  describe('getBalance', () => {
    it('should return balance equal to portfolio currency when asset is zero', () => {
      trader['portfolio'].currency = 500;
      trader['portfolio'].asset = 0;
      trader['price'] = 100;
      expect(trader['getBalance']()).toBe(500);
    });

    it('should return balance equal to price multiplied by asset when currency is zero', () => {
      trader['portfolio'].currency = 0;
      trader['portfolio'].asset = 2;
      trader['price'] = 150;
      expect(trader['getBalance']()).toBe(300);
    });

    it('should return balance equal to the sum of currency and asset value', () => {
      trader['portfolio'].currency = 200;
      trader['portfolio'].asset = 3;
      trader['price'] = 100;
      expect(trader['getBalance']()).toBe(500);
    });
  });
  describe('updatePosition', () => {
    it('should return correct cost for a long position', () => {
      trader['fee'] = 0.9975;
      trader['portfolio'].currency = 1000;
      trader['price'] = 100;
      // For a long position:
      // cost = (1 - fee) * portfolio.currency
      // cost = (1 - 0.9975) * 1000 = 0.0025 * 1000 = 2.5
      const { cost } = trader['updatePosition']('long');
      expect(cost).toBe(2.5);
    });

    it('should return correct amount for a long position', () => {
      trader['fee'] = 0.9975;
      trader['portfolio'].currency = 1000;
      trader['price'] = 100;
      // For a long position:
      // amount is set to portfolio.asset after adding extractFee(currency/price)
      // currency/price = 1000/100 = 10; extractFee(10) ≈ 10 * 0.9975 = 9.975.
      const { amount } = trader['updatePosition']('long');
      expect(amount).toBe(9.975);
    });

    it('should return correct effectivePrice for a long position', () => {
      trader['fee'] = 0.9975;
      trader['price'] = 100;
      // effectivePrice = price * fee = 100 * 0.9975 = 99.75.
      const { effectivePrice } = trader['updatePosition']('long');
      expect(effectivePrice).toBe(99.75);
    });

    it('should set portfolio.currency to zero after a long position', () => {
      trader['price'] = 100;
      trader['updatePosition']('long');
      expect(trader['portfolio'].currency).toBe(0);
    });

    it('should increment number of trade after a long position', () => {
      trader['price'] = 100;
      trader['updatePosition']('long');
      expect(trader['trades']).toBe(1);
    });

    it('should mark exposed as true after a long position', () => {
      trader['price'] = 100;
      trader['updatePosition']('long');
      expect(trader['exposed']).toBeTruthy();
    });

    describe('when executing a short position', () => {
      it('should return correct cost for a short position', () => {
        // Simulate that a long position is already held.
        // For example, after a long trade, asset ≈ 9.975 and currency = 0.
        trader['fee'] = 0.9975;
        trader['portfolio'] = { currency: 0, asset: 9.975 };
        trader['price'] = 100;
        trader['exposed'] = true;
        // For a short position:
        // cost = (1 - fee) * (asset * price)
        // = 0.0025 * (9.975 * 100) = 0.0025 * 997.5 ≈ 2.49375.
        const { cost } = trader['updatePosition']('short');
        expect(cost).toBe(2.49375);
      });

      it('should return correct amount for a short position', () => {
        // Simulate that a long position is already held.
        // For example, after a long trade, asset ≈ 9.975 and currency = 0.
        trader['fee'] = 0.9975;
        trader['portfolio'] = { currency: 0, asset: 9.975 };
        trader['price'] = 100;
        trader['exposed'] = true;
        // For a short position:
        // portfolio.currency is increased by extractFee(asset * price)
        // asset * price = 9.975 * 100 = 997.5; extractFee(997.5) ≈ 997.5 * 0.9975 ≈ 995.00625.
        // Then, amount = portfolio.currency / price = 995.00625 / 100 ≈ 9.9500625.
        const { amount } = trader['updatePosition']('short');
        expect(amount).toBe(9.9500625);
      });

      it('should return correct effectivePrice for a short position', () => {
        trader['fee'] = 0.9975;
        trader['price'] = 100;
        trader['exposed'] = true;
        // effectivePrice remains price * fee = 100 * 0.9975 = 99.75.
        const result = trader['updatePosition']('short');
        expect(result.effectivePrice).toBe(99.75);
      });

      it('should set portfolio.asset to zero after a short position', () => {
        trader['price'] = 100;
        trader['updatePosition']('short');
        expect(trader['portfolio'].asset).toBe(0);
      });

      it('should mark exposed as false after a short position', () => {
        trader['price'] = 100;
        trader['updatePosition']('short');
        expect(trader['exposed']).toBe(false);
      });

      it('should increment number of trade after a short position', () => {
        trader['price'] = 100;
        trader['updatePosition']('short');
        expect(trader['trades']).toBe(1);
      });
    });
  });
  describe('stopTrigger', () => {
    it('should throw if no candle are set', () => {
      expect(() => trader['stopTrigger']()).toThrowError(PluginError);
    });
    it('should emit "triggerFired" with correct id and date', () => {
      trader['candle'] = { start: toTimestamp('2025-01-01T00:00:00Z'), close: 150 };
      const trailingStopArgs = { initialPrice: 100, trail: 10, onTrigger: () => {} };
      trader['activeStopTrigger'] = {
        id: 'trigger-1',
        adviceId: 'advice-50',
        instance: new TrailingStop(trailingStopArgs),
      };
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({
        cost: 10,
        amount: 200,
        effectivePrice: 99.75,
      }));
      trader['stopTrigger']();
      expect(trader['deferredEmit']).toHaveBeenNthCalledWith(1, TRIGGER_FIRED_EVENT, {
        id: 'trigger-1',
        date: toTimestamp('2025-01-01T00:01:00Z'),
      });
    });
    it('should emit "portfolioChange"', () => {
      trader['candle'] = { start: toTimestamp('2025-01-01T00:00:00Z'), close: 150 };
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({
        cost: 10,
        amount: 200,
        effectivePrice: 99.75,
      }));
      trader['stopTrigger']();
      expect(trader['deferredEmit']).toHaveBeenNthCalledWith(2, PORTFOLIO_CHANGE_EVENT, {
        asset: 0,
        currency: 1000,
      });
    });
    it('should emit "portfolioValueChange"', () => {
      trader['candle'] = { start: toTimestamp('2025-01-01T00:00:00Z'), close: 150 };
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({
        cost: 10,
        amount: 200,
        effectivePrice: 99.75,
      }));
      trader['stopTrigger']();
      expect(trader['deferredEmit']).toHaveBeenNthCalledWith(3, PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 1000,
      });
    });
    it('should emit "tradeCompleted" with the correct payload', () => {
      trader['candle'] = { start: toTimestamp('2025-01-01T00:00:00Z'), close: 150 };
      trader['price'] = 200;
      trader['tradeId'] = 'trade-1';
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({
        cost: 100,
        amount: 3,
        effectivePrice: 190,
      }));
      const trailingStopArgs = { initialPrice: 100, trail: 10, onTrigger: () => {} };
      trader['activeStopTrigger'] = {
        id: 'trigger-1',
        adviceId: 'advice-1',
        instance: new TrailingStop(trailingStopArgs),
      };
      trader['stopTrigger']();
      const expectedPayload = {
        id: 'trade-1',
        adviceId: 'advice-1',
        action: 'sell',
        cost: 100,
        amount: 3,
        price: 200,
        portfolio: trader['portfolio'],
        balance: 1000,
        date: toTimestamp('2025-01-01T00:01:00Z'),
        effectivePrice: 190,
        feePercent: 0.25,
      };
      expect(trader['deferredEmit']).toHaveBeenNthCalledWith(4, TRADE_COMPLETED_EVENT, expectedPayload);
    });
    it('should delete activeStopTrigger after execution', () => {
      trader['candle'] = { start: toTimestamp('2025-01-01T00:00:00Z'), close: 150 };
      vi.spyOn(trader, 'updatePosition').mockImplementation(() => ({
        cost: 100,
        amount: 3,
        effectivePrice: 190,
      }));
      trader['stopTrigger']();
      expect(trader['activeStopTrigger']).toBeUndefined();
    });
  });
});
