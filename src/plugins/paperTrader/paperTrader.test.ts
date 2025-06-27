import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginError } from '../../errors/plugin/plugin.error';
import { toTimestamp } from '../../utils/date/date.utils';
import {
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
  TRADE_COMPLETED_EVENT,
  TRADE_INITIATED_EVENT,
} from '../plugin.const';
import { PaperTrader } from './paperTrader';
import { PapertraderConfig } from './paperTrader.types';

vi.mock('@services/logger', () => ({ warning: vi.fn(), info: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({ mode: 'realtime' })),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

describe('PaperTrader', () => {
  const defaultAdvice: Advice = { id: 'advice-100', recommendation: 'short', date: toTimestamp('2020') };
  const defaultCandle: Candle = { close: 100, high: 150, low: 90, open: 110, start: toTimestamp('2025'), volume: 10 };
  const papertraderConfig: PapertraderConfig = {
    name: 'PaperTrader',
    feeUsing: 'maker',
    feeMaker: 0.25,
    feeTaker: 0.4,
    simulationBalance: {
      asset: 0,
      currency: 1000,
    },
  };
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
      trader['warmupCandle'] = { close: 130 } as Candle;

      trader.onStrategyWarmupCompleted();

      expect(trader['warmupCompleted']).toBe(true);
    });
    it('should call process one minute candle function', () => {
      trader['warmupCandle'] = { close: 130 } as Candle;
      const processOneMinuteCandleSpy = vi.spyOn(trader as any, 'processOneMinuteCandle');

      trader.onStrategyWarmupCompleted();

      expect(processOneMinuteCandleSpy).toHaveBeenCalledExactlyOnceWith({ close: 130 });
    });
  });
  describe('onStrategyAdvice', () => {
    it('should ignore unknown recommendation', () => {
      const unknownAdvice = {
        id: 'advice-100',
        recommendation: 'other than shoart and long reco',
      } as unknown as Advice;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');
      trader.onStrategyAdvice(unknownAdvice);
      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });
    it('should emit tradeInitiated', () => {
      trader['price'] = 100;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');
      vi.spyOn(trader as any, 'updatePosition').mockImplementation(() => ({}));
      trader.onStrategyAdvice(defaultAdvice);
      expect(deferredEmitSpy).toHaveBeenNthCalledWith(1, TRADE_INITIATED_EVENT, {
        id: 'trade-1',
        adviceId: defaultAdvice.id,
        action: 'sell',
        portfolio: papertraderConfig.simulationBalance,
        balance: 1000,
        date: defaultAdvice.date,
      });
    });
    it('should emit portfolioChange', () => {
      trader['price'] = 100;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');
      vi.spyOn(trader as any, 'updatePosition').mockImplementation(() => ({}));
      trader.onStrategyAdvice(defaultAdvice);
      expect(deferredEmitSpy).toHaveBeenNthCalledWith(2, PORTFOLIO_CHANGE_EVENT, {
        asset: 0,
        currency: 1000,
      });
    });
    it('should emit portfolioValueChange', () => {
      trader['price'] = 100;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');
      vi.spyOn(trader as any, 'updatePosition').mockImplementation(() => ({}));
      trader.onStrategyAdvice(defaultAdvice);
      expect(deferredEmitSpy).toHaveBeenNthCalledWith(3, PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 1000,
      });
    });
    it('should emit tradeCompleted', () => {
      trader['price'] = 100;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');
      vi.spyOn(trader as any, 'updatePosition').mockImplementation(() => ({
        cost: 10,
        amount: 200,
        effectivePrice: 99.75,
      }));
      trader.onStrategyAdvice(defaultAdvice);
      expect(deferredEmitSpy).toHaveBeenNthCalledWith(4, TRADE_COMPLETED_EVENT, {
        id: 'trade-1',
        adviceId: defaultAdvice.id,
        action: 'sell',
        cost: 10,
        amount: 200,
        price: 100,
        portfolio: { asset: 0, currency: 1000 },
        balance: 1000,
        date: defaultAdvice.date,
        effectivePrice: 99.75,
        feePercent: 0.25,
      });
    });
  });
  describe('processOneMinuteCandle', () => {
    it('should store the candle as warmupCandle during warmup', () => {
      trader['warmupCompleted'] = false;
      trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['warmupCandle']).toEqual(defaultCandle);
    });
    it('should NOT update price during warmup', () => {
      trader['warmupCompleted'] = false;
      trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['price']).toBe(0);
    });
    it('should update price when warmup is done', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = 100;
      trader['exposed'] = false;

      trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['price']).toBe(100);
    });
    it('should set balance when warmup is done & balance is NOT set', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = null;
      trader['price'] = 100;
      trader['exposed'] = false;

      trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['balance']).toBe(1000);
    });
    it('should emit portfolio change event when warmup is done & balance is NOT set', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = null;
      trader['price'] = 100;
      trader['exposed'] = false;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');

      trader['processOneMinuteCandle'](defaultCandle);

      expect(deferredEmitSpy).toHaveBeenNthCalledWith(1, PORTFOLIO_CHANGE_EVENT, {
        asset: 0,
        currency: 1000,
      });
    });
    it('should emit portfolio value change event when warmup is done & balance is NOT set', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = null;
      trader['price'] = 100;
      trader['exposed'] = false;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');

      trader['processOneMinuteCandle'](defaultCandle);

      expect(deferredEmitSpy).toHaveBeenNthCalledWith(2, PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 1000,
      });
    });
    it('should emit portfolio value change event when warmup is done & exposed', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = 10;
      trader['price'] = 100;
      trader['exposed'] = true;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');

      trader['processOneMinuteCandle'](defaultCandle);

      expect(deferredEmitSpy).toHaveBeenCalledExactlyOnceWith(PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 1000,
      });
    });
    it('should NOT emit portfolio value change event when warmup is done & NOT exposed', () => {
      trader['warmupCompleted'] = true;
      trader['balance'] = 10;
      trader['price'] = 100;
      trader['exposed'] = false;
      const deferredEmitSpy = vi.spyOn(trader as any, 'deferredEmit');

      trader['processOneMinuteCandle'](defaultCandle);

      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });
    it('should emit portfolio events only once when starting balance is zero', () => {
      const zeroConfig = {
        ...papertraderConfig,
        simulationBalance: { asset: 0, currency: 0 },
      } as PapertraderConfig;
      trader = new PaperTrader(zeroConfig);
      trader['deferredEmit'] = vi.fn();
      trader['warmupCompleted'] = true;
      trader['price'] = 100;
      trader['exposed'] = false;

      trader['processOneMinuteCandle'](defaultCandle);
      trader['processOneMinuteCandle'](defaultCandle);

      expect(trader['deferredEmit']).toHaveBeenNthCalledWith(1, PORTFOLIO_CHANGE_EVENT, {
        asset: 0,
        currency: 0,
      });
      expect(trader['deferredEmit']).toHaveBeenNthCalledWith(2, PORTFOLIO_VALUE_CHANGE_EVENT, {
        balance: 0,
      });
      expect(trader['deferredEmit']).toHaveBeenCalledTimes(2);
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
});
